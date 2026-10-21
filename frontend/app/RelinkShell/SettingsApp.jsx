// SettingsApp — the witness's settings, as a desk window.
//
// Launched from the Start menu (dock:false, so it isn't a dock app icon).
// The window is TABBED — the one giant scroll made it impossible to find
// anything (ruling, 2026-07-23): GENERAL (account, desk, sound, realm, press,
// hotkeys),
// LOOK (the cosmetic dress — colors + presets), MODELS (inference,
// providers, per-being routes), API (every outward key: channel keys,
// email, web access, service keys), SECURITY (encryption, backups).
// Deep-links (/provider, /model, a platform window's MANAGE KEYS) land on
// the right tab through the same latched settings-focus seam that used to
// scroll.

import './SettingsApp.css';
import './SettingsApp-look.css';
import './SettingsApp-sections.css';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { AppTitle } from './app-title.jsx';
import { takeSettingsFocus, onSettingsFocus } from './settings-focus.js';
import { AccountSection } from './AccountSection.jsx';
import { EnterAsSection } from './EnterAsSection.jsx';
import { LanguageSection } from './LanguageSection.jsx';
import { DeskSection } from './DeskSection.jsx';
import { LookSection } from './LookSection.jsx';
import { PinsSection } from './PinsSection.jsx';
import { RealmSection } from './RealmSection.jsx';
import { SoundSection } from './SoundSection.jsx';
import { InferenceSection } from './InferenceSection.jsx';
import { HotkeysSection } from './HotkeysSection.jsx';
import { ModelsSection } from './ModelsSection.jsx';
import { ModelFoldersSection } from './ModelFoldersSection.jsx';
import { SecuritySection } from './SecuritySection.jsx';
import { RemoteSection } from './RemoteSection.jsx';
import { DocPressSection } from './DocPressSection.jsx';
import { ApiTab } from './SettingsApiTab.jsx';

const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
  </svg>
);

const GeneralTab = () => (
  <>
    <AccountSection />
    <EnterAsSection />
    <LanguageSection />
    <DeskSection />
    <SoundSection />
    <RealmSection />
    <DocPressSection />
    <HotkeysSection />
  </>
);

const ModelsTab = ({ focus }) => (
  <>
    <InferenceSection />
    <ModelFoldersSection />
    <ModelsSection focus={focus} />
  </>
);

// Every key that reaches the outside world, in one place — the platform
// windows decide WHO speaks; this tab holds WHAT unlocks the door.
// Remote sits beside Security: a phone on the tailnet is a security posture
// before it is a convenience (docs/security/remote-surface.md).
const SecurityTab = () => (
  <>
    <SecuritySection />
    <RemoteSection />
  </>
);

// The witness's cosmetic control — its own tab, never buried in GENERAL.
const LookTab = () => <LookSection />;

// The memory window: what each being holds close (read-only by design).
const MemoryTab = () => <PinsSection />;

const TABS = [
  { id: 'general', Body: GeneralTab },
  { id: 'look', Body: LookTab },
  { id: 'memory', Body: MemoryTab },
  { id: 'models', Body: ModelsTab },
  { id: 'api', Body: ApiTab },
  { id: 'security', Body: SecurityTab },
];

// A deep-link target names a SECTION; the map says which tab carries it.
const TAB_OF_FOCUS = Object.freeze({
  look: 'look',
  pins: 'memory',
  providers: 'models',
  route: 'models',
  'channel-keys': 'api',
  email: 'api',
  web: 'api',
  security: 'security',
});

const SettingsBody = () => {
  // The latch is read ONCE here (the window mounts async after the command
  // fires) and handed down — sections keep their own scroll behavior.
  const [focus, setFocus] = useState(() => takeSettingsFocus());
  const [tab, setTab] = useState(() => TAB_OF_FOCUS[focus] || 'general');
  useEffect(() => onSettingsFocus((target) => {
    setFocus(target);
    if (TAB_OF_FOCUS[target]) setTab(TAB_OF_FOCUS[target]);
  }), []);

  const active = TABS.find((tabDef) => tabDef.id === tab) || TABS[0];
  const { Body } = active;
  const { t } = useTranslation('settings');

  return (
    <div className="settings-host">
      <div className="settings-tabs" role="tablist" aria-label={t('tablistAria')}>
        {TABS.map((tabDef) => {
          const on = tabDef.id === active.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`settings-tab label-data${on ? ' is-on' : ''}`}
              onClick={() => { uiSound('toggle'); setTab(tabDef.id); }}
            >
              {t(`tabs.${tabDef.id}`)}
            </button>
          );
        })}
      </div>
      {/* One tab at a time, keyed — a stale board never carries across a
          switch. The .settings register on the panel carries the scroll,
          padding, and section rhythm the sections were written against. */}
      <div role="tabpanel" className="settings-tab-panel settings" tabIndex={0}>
        <Body key={active.id} focus={focus} />
      </div>
    </div>
  );
};

export const settingsApp = {
  label: 'SETTINGS',
  labelKey: 'apps.settings',
  icon: <SettingsIcon />,
  title: <AppTitle label="SETTINGS" labelKey="apps.settings" />,
  Body: SettingsBody,
  storageKey: 'settings',
  dock: false, // launched from the Start menu, not a dock app icon
};
