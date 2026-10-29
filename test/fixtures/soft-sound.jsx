import React from 'react';
import { createRoot } from 'react-dom/client';
// Boots as main.jsx does: catalogs, then the stored reading size, then render.
import '../../frontend/i18n/index.js';
import { SoundSection } from '../../frontend/app/RelinkShell/SoundSection.jsx';
import { TextSizeQuick } from '../../frontend/app/TextSizeQuick/TextSizeQuick.jsx';
import { bootTextSize } from '../../frontend/services/text-size.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';

bootTextSize();
createRoot(document.getElementById('root')).render(<main style={{ padding: 20 }}>
  <SoundSection />
  <TextSizeQuick />
</main>);
