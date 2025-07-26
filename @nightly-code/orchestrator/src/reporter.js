const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { table } = require('table');
const chalk = require('chalk');

class Reporter {
  constructor (options = {}) {
    this.options = {
      workingDir: options.workingDir || process.cwd(),
      reportsDir: options.reportsDir || path.join(process.cwd(), '.nightly-code', 'reports'),
      logger: options.logger || console
    };

    this.notificationHandlers = {
      email: this.sendEmailNotification.bind(this),
      slack: this.sendSlackNotification.bind(this),
      webhook: this.sendWebhookNotification.bind(this)
    };

    this.ensureReportsDirectory();
  }

  async ensureReportsDirectory () {
    await fs.ensureDir(this.options.reportsDir);
  }

  async generateSessionReport (sessionState, results) {
    this.options.logger.info('Generating session report', {
      sessionId: sessionState.sessionId,
      completedTasks: results.completed,
      totalTasks: results.totalTasks
    });

    const report = {
      sessionId: sessionState.sessionId,
      timestamp: new Date().toISOString(),
      duration: sessionState.endTime - sessionState.startTime,
      startTime: new Date(sessionState.startTime).toISOString(),
      endTime: new Date(sessionState.endTime).toISOString(),

      // Task results
      totalTasks: results.totalTasks,
      completedTasks: results.completed,
      failedTasks: results.failed,
      skippedTasks: results.skipped,

      // Detailed task information
      taskDetails: {
        completed: sessionState.completedTasks.map(ct => ({
          id: ct.task.id,
          title: ct.task.title,
          type: ct.task.type,
          duration: ct.result.duration,
          filesChanged: ct.result.filesChanged?.length || 0,
          completedAt: new Date(ct.completedAt).toISOString(),
          validation: ct.validation
        })),

        failed: sessionState.failedTasks.map(ft => ({
          id: ft.task.id,
          title: ft.task.title,
          type: ft.task.type,
          error: ft.error,
          failedAt: new Date(ft.failedAt).toISOString()
        }))
      },

      // Resource usage
      resourceUsage: {
        checkpoints: sessionState.checkpoints.length,
        peakMemory: this.calculatePeakMemory(sessionState.resourceUsage),
        averageCpu: this.calculateAverageCpu(sessionState.resourceUsage),
        resourceHistory: sessionState.resourceUsage
      },

      // Git information
      branches: sessionState.sessionBranches || [],

      // Performance metrics
      metrics: this.calculateMetrics(sessionState, results),

      // Summary
      success: results.failed === 0,
      completionRate: results.totalTasks > 0
        ? Math.round((results.completed / results.totalTasks) * 100)
        : 0
    };

    // Save detailed JSON report
    const reportFile = path.join(
      this.options.reportsDir,
      `${sessionState.sessionId}.json`
    );

    await fs.writeJson(reportFile, report, { spaces: 2 });

    // Generate human-readable formats
    await this.generateMarkdownReport(report);
    await this.generateHtmlReport(report);

    this.options.logger.info('Session report generated', {
      reportFile,
      success: report.success,
      completionRate: report.completionRate
    });

    return report;
  }

  calculatePeakMemory (resourceUsage) {
    if (!resourceUsage || resourceUsage.length === 0) return 0;
    return Math.max(...resourceUsage.map(r => r.memory));
  }

  calculateAverageCpu (resourceUsage) {
    if (!resourceUsage || resourceUsage.length === 0) return 0;
    const total = resourceUsage.reduce((sum, r) => sum + r.cpu, 0);
    return Math.round((total / resourceUsage.length) * 100) / 100;
  }

  calculateMetrics (sessionState, results) {
    const duration = sessionState.endTime - sessionState.startTime;
    const completedTasks = sessionState.completedTasks || [];

    return {
      sessionEfficiency: results.totalTasks > 0
        ? Math.round((results.completed / results.totalTasks) * 100)
        : 0,

      averageTaskDuration: completedTasks.length > 0
        ? Math.round(completedTasks.reduce((sum, ct) => sum + (ct.result.duration || 0), 0) / completedTasks.length)
        : 0,

      tasksPerHour: duration > 0
        ? Math.round((results.completed / (duration / 3600000)) * 100) / 100
        : 0,

      timeUtilization: duration > 0
        ? Math.round((completedTasks.reduce((sum, ct) => sum + (ct.result.duration || 0), 0) / duration) * 100)
        : 0,

      errorRate: results.totalTasks > 0
        ? Math.round((results.failed / results.totalTasks) * 100)
        : 0,

      checkpointFrequency: sessionState.checkpoints?.length || 0,

      branchesCreated: sessionState.sessionBranches?.length || 0,

      totalFilesChanged: completedTasks.reduce((sum, ct) =>
        sum + (ct.result.filesChanged?.length || 0), 0)
    };
  }

  async generateMarkdownReport (report) {
    const mdContent = this.formatMarkdownReport(report);
    const mdFile = path.join(
      this.options.reportsDir,
      `${report.sessionId}.md`
    );

    await fs.writeFile(mdFile, mdContent);
    return mdFile;
  }

  formatMarkdownReport (report) {
    const duration = Math.round(report.duration / 60000); // Convert to minutes
    const successIcon = report.success ? '✅' : '❌';

    return `# Nightly Code Session Report ${successIcon}

**Session ID:** ${report.sessionId}  
**Date:** ${new Date(report.timestamp).toLocaleString()}  
**Duration:** ${duration} minutes  
**Success Rate:** ${report.completionRate}%

## Summary

- **Total Tasks:** ${report.totalTasks}
- **Completed:** ${report.completedTasks} ✅
- **Failed:** ${report.failedTasks} ❌
- **Skipped:** ${report.skippedTasks} ⏭️

## Performance Metrics

| Metric | Value |
|--------|-------|
| Session Efficiency | ${report.metrics.sessionEfficiency}% |
| Average Task Duration | ${Math.round(report.metrics.averageTaskDuration / 1000)}s |
| Tasks per Hour | ${report.metrics.tasksPerHour} |
| Time Utilization | ${report.metrics.timeUtilization}% |
| Error Rate | ${report.metrics.errorRate}% |
| Branches Created | ${report.metrics.branchesCreated} |
| Files Changed | ${report.metrics.totalFilesChanged} |

## Completed Tasks

${report.taskDetails.completed.map(task => `
### ${task.title}

- **ID:** ${task.id}
- **Type:** ${task.type}
- **Duration:** ${Math.round(task.duration / 1000)}s
- **Files Changed:** ${task.filesChanged}
- **Completed:** ${new Date(task.completedAt).toLocaleString()}
- **Validation:** ${task.validation.passed ? '✅ Passed' : '❌ Failed'}
${task.validation.errors?.length > 0
    ? `
- **Validation Errors:**
${task.validation.errors.map(e => `  - ${e}`).join('\\n')}
`
    : ''}
`).join('\\n')}

${report.taskDetails.failed.length > 0
    ? `
## Failed Tasks

${report.taskDetails.failed.map(task => `
### ${task.title} ❌

- **ID:** ${task.id}
- **Type:** ${task.type}
- **Error:** ${task.error}
- **Failed At:** ${new Date(task.failedAt).toLocaleString()}
`).join('\\n')}
`
    : ''}

## Resource Usage

- **Peak Memory:** ${Math.round(report.resourceUsage.peakMemory / 1024 / 1024)}MB
- **Average CPU:** ${report.resourceUsage.averageCpu}%
- **Checkpoints:** ${report.resourceUsage.checkpoints}

## Git Activity

${report.branches.map(branch => `
- **Branch:** ${branch.branchName}
- **Task:** ${branch.taskId}
- **Created:** ${new Date(branch.createdAt).toLocaleString()}
`).join('\\n')}

---

*Generated by Nightly Code Orchestrator on ${new Date(report.timestamp).toLocaleString()}*
`;
  }

  async generateHtmlReport (report) {
    const htmlContent = this.formatHtmlReport(report);
    const htmlFile = path.join(
      this.options.reportsDir,
      `${report.sessionId}.html`
    );

    await fs.writeFile(htmlFile, htmlContent);
    return htmlFile;
  }

  formatHtmlReport (report) {
    const duration = Math.round(report.duration / 60000);
    const successClass = report.success ? 'success' : 'failure';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nightly Code Session Report - ${report.sessionId}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { color: #333; margin-bottom: 10px; }
        .success { color: #28a745; }
        .failure { color: #dc3545; }
        .warning { color: #ffc107; }
        .info { color: #17a2b8; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #f8f9fa; padding: 20px; border-radius: 6px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .metric-label { color: #666; font-size: 0.9em; }
        .task-list { margin-bottom: 30px; }
        .task-item { background: #f8f9fa; margin-bottom: 15px; padding: 15px; border-radius: 6px; border-left: 4px solid #28a745; }
        .task-item.failed { border-left-color: #dc3545; }
        .task-title { font-weight: bold; margin-bottom: 10px; }
        .task-details { font-size: 0.9em; color: #666; }
        .chart-container { margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: 600; }
        .progress-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s ease; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="${successClass}">
                ${report.success ? '✅' : '❌'} Nightly Code Session Report
            </h1>
            <p><strong>Session:</strong> ${report.sessionId}</p>
            <p><strong>Date:</strong> ${new Date(report.timestamp).toLocaleString()}</p>
            <p><strong>Duration:</strong> ${duration} minutes</p>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value ${report.success ? 'success' : 'failure'}">${report.completionRate}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value info">${report.completedTasks}</div>
                <div class="metric-label">Completed Tasks</div>
            </div>
            <div class="metric-card">
                <div class="metric-value warning">${report.failedTasks}</div>
                <div class="metric-label">Failed Tasks</div>
            </div>
            <div class="metric-card">
                <div class="metric-value info">${report.metrics.tasksPerHour}</div>
                <div class="metric-label">Tasks/Hour</div>
            </div>
        </div>

        <h2>Performance Overview</h2>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${report.completionRate}%"></div>
        </div>
        <p style="text-align: center; margin-top: 10px;">${report.completedTasks} of ${report.totalTasks} tasks completed</p>

        <h2>Detailed Metrics</h2>
        <table>
            <tr><th>Metric</th><th>Value</th></tr>
            <tr><td>Average Task Duration</td><td>${Math.round(report.metrics.averageTaskDuration / 1000)}s</td></tr>
            <tr><td>Time Utilization</td><td>${report.metrics.timeUtilization}%</td></tr>
            <tr><td>Error Rate</td><td>${report.metrics.errorRate}%</td></tr>
            <tr><td>Branches Created</td><td>${report.metrics.branchesCreated}</td></tr>
            <tr><td>Files Changed</td><td>${report.metrics.totalFilesChanged}</td></tr>
            <tr><td>Peak Memory Usage</td><td>${Math.round(report.resourceUsage.peakMemory / 1024 / 1024)}MB</td></tr>
            <tr><td>Average CPU Usage</td><td>${report.resourceUsage.averageCpu}%</td></tr>
        </table>

        ${report.taskDetails.completed.length > 0
    ? `
        <h2>Completed Tasks</h2>
        <div class="task-list">
            ${report.taskDetails.completed.map(task => `
            <div class="task-item">
                <div class="task-title">${task.title}</div>
                <div class="task-details">
                    <strong>ID:</strong> ${task.id} | 
                    <strong>Type:</strong> ${task.type} | 
                    <strong>Duration:</strong> ${Math.round(task.duration / 1000)}s | 
                    <strong>Files:</strong> ${task.filesChanged} | 
                    <strong>Status:</strong> ${task.validation.passed ? '✅ Validated' : '❌ Validation Failed'}
                </div>
            </div>
            `).join('')}
        </div>
        `
    : ''}

        ${report.taskDetails.failed.length > 0
    ? `
        <h2>Failed Tasks</h2>
        <div class="task-list">
            ${report.taskDetails.failed.map(task => `
            <div class="task-item failed">
                <div class="task-title">${task.title} ❌</div>
                <div class="task-details">
                    <strong>ID:</strong> ${task.id} | 
                    <strong>Type:</strong> ${task.type} | 
                    <strong>Error:</strong> ${task.error}
                </div>
            </div>
            `).join('')}
        </div>
        `
    : ''}

        <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em;">
            Generated by Nightly Code Orchestrator on ${new Date(report.timestamp).toLocaleString()}
        </div>
    </div>
</body>
</html>`;
  }

  async sendNotifications (report, config) {
    if (!config || !config.notifications) {
      this.options.logger.debug('No notification configuration found');
      return;
    }

    const results = {
      sent: 0,
      failed: 0,
      details: []
    };

    for (const [type, notificationConfig] of Object.entries(config.notifications)) {
      if (notificationConfig.enabled && this.notificationHandlers[type]) {
        try {
          await this.notificationHandlers[type](report, notificationConfig);
          results.sent++;
          results.details.push(`${type}: sent successfully`);
        } catch (error) {
          results.failed++;
          results.details.push(`${type}: failed - ${error.message}`);

          this.options.logger.error(`Failed to send ${type} notification`, {
            error: error.message
          });
        }
      }
    }

    this.options.logger.info('Notifications processed', results);
    return results;
  }

  async sendEmailNotification (report, config) {
    this.options.logger.info('Sending email notification');

    const transporter = nodemailer.createTransporter({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_secure,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass
      }
    });

    const subject = `Nightly Code Session ${report.success ? 'Completed' : 'Failed'} - ${report.completionRate}% Success`;
    const htmlContent = await this.generateEmailContent(report);

    const mailOptions = {
      from: config.from,
      to: config.to,
      subject,
      html: htmlContent,
      attachments: [
        {
          filename: `${report.sessionId}-report.json`,
          content: JSON.stringify(report, null, 2),
          contentType: 'application/json'
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    this.options.logger.info('Email notification sent successfully');
  }

  async generateEmailContent (report) {
    const duration = Math.round(report.duration / 60000);
    const statusEmoji = report.success ? '✅' : '❌';

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: ${report.success ? '#28a745' : '#dc3545'};">
            ${statusEmoji} Nightly Code Session Report
        </h1>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
            <h3>Session Summary</h3>
            <ul>
                <li><strong>Session ID:</strong> ${report.sessionId}</li>
                <li><strong>Duration:</strong> ${duration} minutes</li>
                <li><strong>Success Rate:</strong> ${report.completionRate}%</li>
                <li><strong>Tasks Completed:</strong> ${report.completedTasks}/${report.totalTasks}</li>
            </ul>
        </div>
        
        ${report.taskDetails.completed.length > 0
    ? `
        <div style="margin-bottom: 20px;">
            <h3 style="color: #28a745;">✅ Completed Tasks (${report.taskDetails.completed.length})</h3>
            <ul>
                ${report.taskDetails.completed.map(task => `
                <li><strong>${task.title}</strong> (${task.type}) - ${Math.round(task.duration / 1000)}s</li>
                `).join('')}
            </ul>
        </div>
        `
    : ''}
        
        ${report.taskDetails.failed.length > 0
    ? `
        <div style="margin-bottom: 20px;">
            <h3 style="color: #dc3545;">❌ Failed Tasks (${report.taskDetails.failed.length})</h3>
            <ul>
                ${report.taskDetails.failed.map(task => `
                <li><strong>${task.title}</strong> (${task.type}) - ${task.error}</li>
                `).join('')}
            </ul>
        </div>
        `
    : ''}
        
        <div style="background: #e9ecef; padding: 15px; border-radius: 5px; margin-top: 20px;">
            <h4>Performance Metrics</h4>
            <ul>
                <li>Tasks per Hour: ${report.metrics.tasksPerHour}</li>
                <li>Time Utilization: ${report.metrics.timeUtilization}%</li>
                <li>Files Changed: ${report.metrics.totalFilesChanged}</li>
                <li>Branches Created: ${report.metrics.branchesCreated}</li>
            </ul>
        </div>
        
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
            Generated by Nightly Code Orchestrator<br>
            ${new Date(report.timestamp).toLocaleString()}
        </p>
    </div>
    `;
  }

  async sendSlackNotification (report, config) {
    this.options.logger.info('Sending Slack notification');

    const duration = Math.round(report.duration / 60000);
    const statusEmoji = report.success ? ':white_check_mark:' : ':x:';
    const statusColor = report.success ? 'good' : 'danger';

    const payload = {
      channel: config.channel,
      username: 'Nightly Code Bot',
      icon_emoji: ':robot_face:',
      attachments: [
        {
          color: statusColor,
          title: `${statusEmoji} Nightly Code Session ${report.success ? 'Completed' : 'Failed'}`,
          fields: [
            {
              title: 'Session ID',
              value: report.sessionId,
              short: true
            },
            {
              title: 'Duration',
              value: `${duration} minutes`,
              short: true
            },
            {
              title: 'Success Rate',
              value: `${report.completionRate}%`,
              short: true
            },
            {
              title: 'Tasks',
              value: `${report.completedTasks}/${report.totalTasks} completed`,
              short: true
            },
            {
              title: 'Performance',
              value: `${report.metrics.tasksPerHour} tasks/hour`,
              short: true
            },
            {
              title: 'Files Changed',
              value: report.metrics.totalFilesChanged.toString(),
              short: true
            }
          ],
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    if (report.taskDetails.failed.length > 0) {
      payload.attachments.push({
        color: 'danger',
        title: `❌ Failed Tasks (${report.taskDetails.failed.length})`,
        text: report.taskDetails.failed.map(task =>
          `• ${task.title} - ${task.error}`).join('\\n'),
        mrkdwn_in: ['text']
      });
    }

    await axios.post(config.webhook_url, payload);
    this.options.logger.info('Slack notification sent successfully');
  }

  async sendWebhookNotification (report, config) {
    this.options.logger.info('Sending webhook notification', { url: config.url });

    const payload = {
      sessionId: report.sessionId,
      timestamp: report.timestamp,
      success: report.success,
      completionRate: report.completionRate,
      duration: report.duration,
      tasks: {
        total: report.totalTasks,
        completed: report.completedTasks,
        failed: report.failedTasks
      },
      metrics: report.metrics,
      summary: {
        message: `Session ${report.success ? 'completed successfully' : 'failed'} with ${report.completionRate}% success rate`,
        completedTasks: report.taskDetails.completed.map(t => ({
          id: t.id,
          title: t.title,
          type: t.type
        })),
        failedTasks: report.taskDetails.failed.map(t => ({
          id: t.id,
          title: t.title,
          error: t.error
        }))
      }
    };

    const requestConfig = {
      method: config.method || 'POST',
      url: config.url,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Nightly-Code-Orchestrator/1.0',
        ...config.headers
      },
      timeout: 30000
    };

    await axios(requestConfig);
    this.options.logger.info('Webhook notification sent successfully');
  }

  async getLastSessionStatus () {
    try {
      const files = await fs.readdir(this.options.reportsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

      if (jsonFiles.length === 0) {
        return null;
      }

      const latestFile = path.join(this.options.reportsDir, jsonFiles[0]);
      const report = await fs.readJson(latestFile);

      return {
        sessionId: report.sessionId,
        timestamp: report.timestamp,
        success: report.success,
        duration: report.duration,
        completedTasks: report.completedTasks,
        totalTasks: report.totalTasks,
        completionRate: report.completionRate,
        errors: report.taskDetails.failed.map(t => t.error)
      };
    } catch (error) {
      this.options.logger.warn('Failed to get last session status', { error: error.message });
      return null;
    }
  }

  async generateReport (options = {}) {
    const { date, format = 'table', last = 10 } = options;

    let reports = [];

    if (date) {
      // Get reports for specific date
      reports = await this.getReportsForDate(date);
    } else {
      // Get last N reports
      reports = await this.getLastReports(parseInt(last));
    }

    if (reports.length === 0) {
      return 'No reports found for the specified criteria.';
    }

    switch (format) {
      case 'json':
        return JSON.stringify(reports, null, 2);

      case 'markdown':
        return this.formatMarkdownSummary(reports);

      case 'table':
      default:
        return this.formatTableSummary(reports);
    }
  }

  async getReportsForDate (dateString) {
    try {
      const files = await fs.readdir(this.options.reportsDir);
      const reports = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.options.reportsDir, file);
        const report = await fs.readJson(filePath);

        const reportDate = new Date(report.timestamp).toISOString().split('T')[0];
        if (reportDate === dateString) {
          reports.push(report);
        }
      }

      return reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      this.options.logger.warn('Failed to get reports for date', { error: error.message });
      return [];
    }
  }

  async getLastReports (count) {
    try {
      const files = await fs.readdir(this.options.reportsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();

      const reports = [];

      for (const file of jsonFiles.slice(0, count)) {
        const filePath = path.join(this.options.reportsDir, file);
        const report = await fs.readJson(filePath);
        reports.push(report);
      }

      return reports;
    } catch (error) {
      this.options.logger.warn('Failed to get last reports', { error: error.message });
      return [];
    }
  }

  formatTableSummary (reports) {
    if (reports.length === 0) {
      return 'No reports available.';
    }

    const data = [
      ['Session ID', 'Date', 'Duration', 'Tasks', 'Success Rate', 'Status']
    ];

    for (const report of reports) {
      const date = new Date(report.timestamp).toLocaleDateString();
      const duration = Math.round(report.duration / 60000);
      const tasks = `${report.completedTasks}/${report.totalTasks}`;
      const status = report.success ? chalk.green('✅ Success') : chalk.red('❌ Failed');

      data.push([
        `${report.sessionId.substring(0, 20)}...`,
        date,
        `${duration}m`,
        tasks,
        `${report.completionRate}%`,
        status
      ]);
    }

    return table(data, {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      }
    });
  }

  formatMarkdownSummary (reports) {
    if (reports.length === 0) {
      return 'No reports available.';
    }

    let markdown = '# Session Reports Summary\\n\\n';
    markdown += `Total Sessions: ${reports.length}\\n`;

    const successfulSessions = reports.filter(r => r.success).length;
    const successRate = Math.round((successfulSessions / reports.length) * 100);

    markdown += `Successful Sessions: ${successfulSessions}/${reports.length} (${successRate}%)\\n\\n`;

    markdown += '| Session ID | Date | Duration | Tasks | Success Rate | Status |\\n';
    markdown += '|------------|------|----------|-------|--------------|--------|\\n';

    for (const report of reports) {
      const date = new Date(report.timestamp).toLocaleDateString();
      const duration = Math.round(report.duration / 60000);
      const tasks = `${report.completedTasks}/${report.totalTasks}`;
      const status = report.success ? '✅ Success' : '❌ Failed';

      markdown += `| ${report.sessionId.substring(0, 12)}... | ${date} | ${duration}m | ${tasks} | ${report.completionRate}% | ${status} |\\n`;
    }

    return markdown;
  }

  async exportReports (format = 'json', outputPath = null) {
    const reports = await this.getLastReports(100); // Export last 100 reports

    if (reports.length === 0) {
      throw new Error('No reports found to export');
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const defaultFileName = `nightly-code-reports-${timestamp}.${format}`;
    const outputFile = outputPath || path.join(this.options.reportsDir, defaultFileName);

    let content;

    switch (format) {
      case 'json':
        content = JSON.stringify(reports, null, 2);
        break;

      case 'csv':
        content = this.formatCsvExport(reports);
        break;

      case 'markdown':
        content = this.formatMarkdownSummary(reports);
        break;

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    await fs.writeFile(outputFile, content);

    this.options.logger.info('Reports exported', {
      format,
      reportCount: reports.length,
      outputFile
    });

    return outputFile;
  }

  formatCsvExport (reports) {
    const headers = [
      'SessionID',
      'Timestamp',
      'Duration',
      'TotalTasks',
      'CompletedTasks',
      'FailedTasks',
      'SuccessRate',
      'TasksPerHour',
      'FilesChanged',
      'BranchesCreated',
      'PeakMemoryMB',
      'AvgCPU',
      'Success'
    ];

    let csv = `${headers.join(',')}\\n`;

    for (const report of reports) {
      const row = [
        report.sessionId,
        report.timestamp,
        Math.round(report.duration / 60000),
        report.totalTasks,
        report.completedTasks,
        report.failedTasks,
        report.completionRate,
        report.metrics.tasksPerHour,
        report.metrics.totalFilesChanged,
        report.metrics.branchesCreated,
        Math.round(report.resourceUsage.peakMemory / 1024 / 1024),
        report.resourceUsage.averageCpu,
        report.success
      ];

      csv += `${row.join(',')}\\n`;
    }

    return csv;
  }

  async cleanupOldReports (daysToKeep = 30) {
    try {
      const files = await fs.readdir(this.options.reportsDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.options.reportsDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          await fs.remove(filePath);
          deletedCount++;
        }
      }

      this.options.logger.info('Old reports cleaned up', {
        deletedCount,
        daysToKeep
      });

      return deletedCount;
    } catch (error) {
      this.options.logger.warn('Failed to cleanup old reports', { error: error.message });
      return 0;
    }
  }
}

module.exports = { Reporter };
