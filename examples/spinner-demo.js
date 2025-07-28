#!/usr/bin/env node

/**
 * Demo of spinner integration with cli-spinners
 * Shows different spinner types available
 */

const spinner = require('../src/utils/spinner');

async function demoSpinners() {
  console.log('🎮 Spinner Demo - Testing different cli-spinners types\n');

  // Demo 1: Basic spinner with dots12
  await spinner.execute(
    'Loading with dots12 spinner...',
    new Promise(resolve => setTimeout(resolve, 2000)),
    {
      successText: '✅ Dots12 spinner completed!',
      spinner: 'dots12'
    }
  );

  await new Promise(resolve => setTimeout(resolve, 500));

  // Demo 2: Progress-style spinner
  await spinner.execute(
    'Processing with arc spinner...',
    new Promise(resolve => setTimeout(resolve, 2000)),
    {
      successText: '✅ Arc spinner completed!',
      spinner: 'arc'
    }
  );

  await new Promise(resolve => setTimeout(resolve, 500));

  // Demo 3: Progress with multiple steps
  console.log('\n📋 Multi-step progress demo:');
  const progress = spinner.createProgress([
    'Initializing system',
    'Loading configuration',
    'Connecting to services',
    'Finalizing setup'
  ]);

  progress.next();
  await new Promise(resolve => setTimeout(resolve, 1000));

  progress.next();
  await new Promise(resolve => setTimeout(resolve, 1000));

  progress.next();
  await new Promise(resolve => setTimeout(resolve, 1000));

  progress.next();
  await new Promise(resolve => setTimeout(resolve, 1000));

  progress.complete('🎉 All steps completed successfully!');

  await new Promise(resolve => setTimeout(resolve, 500));

  // Demo 4: Error handling
  console.log('\n❌ Error handling demo:');
  try {
    await spinner.execute(
      'This operation will fail...',
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Simulated failure')), 1500);
      }),
      {
        successText: '✅ This should not appear',
        failText: '❌ Operation failed as expected',
        spinner: 'bouncingBar'
      }
    );
  } catch (error) {
    // Expected error
  }

  console.log('\n🎊 Demo completed! Spinners are ready for use.');
}

// Available spinner types from cli-spinners:
const spinnerTypes = [
  'dots', 'dots2', 'dots3', 'dots4', 'dots5', 'dots6', 'dots7', 'dots8', 'dots9', 'dots10', 'dots11', 'dots12',
  'line', 'line2', 'pipe', 'simpleDots', 'simpleDotsScrolling', 'star', 'star2', 'flip', 'hamburger', 'growVertical',
  'growHorizontal', 'balloon', 'balloon2', 'noise', 'bounce', 'boxBounce', 'boxBounce2', 'triangle', 'arc', 'circle',
  'squareCorners', 'circleQuarters', 'circleHalves', 'squish', 'toggle', 'toggle2', 'toggle3', 'toggle4', 'toggle5',
  'toggle6', 'toggle7', 'toggle8', 'toggle9', 'toggle10', 'toggle11', 'toggle12', 'toggle13', 'arrow', 'arrow2',
  'arrow3', 'bouncingBar', 'bouncingBall'
];

if (require.main === module) {
  demoSpinners().catch(console.error);
}

module.exports = { demoSpinners, spinnerTypes };