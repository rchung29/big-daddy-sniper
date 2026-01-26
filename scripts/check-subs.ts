import { initializeSupabase } from '../src/db/supabase';
import { store } from '../src/store';
import { calculateTargetDate, getDayOfWeek, isSubscriptionActiveForDate } from '../src/services/scheduler';

initializeSupabase();
await store.initialize();

const fullSubs = store.getFullSubscriptions();
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let active = 0;
let filtered = 0;

for (const sub of fullSubs) {
  const targetDate = calculateTargetDate(sub.days_in_advance);
  const dayOfWeek = getDayOfWeek(targetDate);
  const isActive = isSubscriptionActiveForDate(sub.target_days, targetDate);

  if (isActive) {
    active++;
  } else {
    filtered++;
    console.log('FILTERED:', sub.restaurant_name, '| target:', targetDate, '(' + dayNames[dayOfWeek] + ') | wants:', sub.target_days?.map(d => dayNames[d]).join(',') || 'any');
  }
}

console.log('\nActive:', active, '| Filtered by target_days:', filtered);
