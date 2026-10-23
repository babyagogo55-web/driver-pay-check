import { CalendarScreen } from './screens/CalendarScreen';
import { ReconcileScreen } from './screens/ReconcileScreen';
import { RecordScreen } from './screens/RecordScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { useApp, type Tab } from './store';

const TABS: { tab: Tab; label: string; icon: string }[] = [
  { tab: 'record', label: '記録', icon: '✎' },
  { tab: 'calendar', label: 'カレンダー', icon: '▦' },
  { tab: 'summary', label: '集計', icon: '¥' },
  { tab: 'reconcile', label: '照合', icon: '⇄' },
  { tab: 'settings', label: '設定', icon: '⚙' },
];

export function App() {
  const app = useApp();
  return (
    <>
      <main>
        {app.tab === 'record' && <RecordScreen />}
        {app.tab === 'calendar' && <CalendarScreen />}
        {app.tab === 'summary' && <SummaryScreen />}
        {app.tab === 'reconcile' && <ReconcileScreen />}
        {app.tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabbar no-print">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            className={app.tab === t.tab ? 'on' : ''}
            aria-current={app.tab === t.tab ? 'page' : undefined}
            onClick={() => app.setTab(t.tab)}
          >
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
