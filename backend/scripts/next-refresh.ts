import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SettingsService } from '../src/settings/settings.service';

async function showNextRefresh() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const settingsService = app.get(SettingsService);

  const cadenceHours = await settingsService.getSettingInt('CADENCE_HOURS');
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  console.log('\n=== NEXT REFRESH SCHEDULE ===\n');
  console.log(`Current time: ${now.toLocaleString()}`);
  console.log(`Cadence: ${cadenceHours} hour(s)\n`);

  // Calculate next signal poller time
  // Signal poller runs when: hour % cadenceHours === 0 && minute === 0
  let nextSignalHour = currentHour;
  let daysToAdd = 0;

  // Find next hour that's divisible by cadenceHours
  while (nextSignalHour % cadenceHours !== 0 || (nextSignalHour === currentHour && currentMinute >= 0)) {
    nextSignalHour++;
    if (nextSignalHour >= 24) {
      nextSignalHour = 0;
      daysToAdd = 1;
      break;
    }
  }

  const nextSignalTime = new Date(now);
  nextSignalTime.setHours(nextSignalHour, 0, 0, 0);
  if (daysToAdd > 0) {
    nextSignalTime.setDate(nextSignalTime.getDate() + daysToAdd);
  }

  const msUntilSignal = nextSignalTime.getTime() - now.getTime();
  const hoursUntilSignal = Math.floor(msUntilSignal / (1000 * 60 * 60));
  const minutesUntilSignal = Math.floor((msUntilSignal % (1000 * 60 * 60)) / (1000 * 60));

  console.log('📊 Signal Poller + Strategy Evaluation:');
  console.log(`   Next run: ${nextSignalTime.toLocaleString()}`);
  console.log(`   Time until: ${hoursUntilSignal}h ${minutesUntilSignal}m\n`);

  // Calculate next reconciliation time (every hour on the hour)
  const nextReconcileTime = new Date(now);
  if (currentMinute === 0) {
    // If we're exactly on the hour, next is in 1 hour
    nextReconcileTime.setHours(currentHour + 1, 0, 0, 0);
  } else {
    // Otherwise, next hour
    nextReconcileTime.setHours(currentHour + 1, 0, 0, 0);
  }

  const msUntilReconcile = nextReconcileTime.getTime() - now.getTime();
  const hoursUntilReconcile = Math.floor(msUntilReconcile / (1000 * 60 * 60));
  const minutesUntilReconcile = Math.floor((msUntilReconcile % (1000 * 60 * 60)) / (1000 * 60));

  console.log('🔄 Reconciliation:');
  console.log(`   Next run: ${nextReconcileTime.toLocaleString()}`);
  console.log(`   Time until: ${hoursUntilReconcile}h ${minutesUntilReconcile}m\n`);

  // Show all scheduled times for today
  console.log('📅 Today\'s Schedule:');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  
  const signalTimes: Date[] = [];
  for (let h = 0; h < 24; h++) {
    if (h % cadenceHours === 0) {
      const time = new Date(today);
      time.setHours(h, 0, 0, 0);
      if (time.getTime() > now.getTime()) {
        signalTimes.push(time);
      }
    }
  }

  if (signalTimes.length > 0) {
    console.log('   Signal Poller times:');
    signalTimes.slice(0, 5).forEach(time => {
      const marker = time.getTime() === nextSignalTime.getTime() ? ' ⬅️  NEXT' : '';
      console.log(`   - ${time.toLocaleTimeString()}${marker}`);
    });
    if (signalTimes.length > 5) {
      console.log(`   ... and ${signalTimes.length - 5} more today`);
    }
  }

  console.log('\n');

  await app.close();
}

showNextRefresh().catch(console.error);

