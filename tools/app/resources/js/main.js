// Jade Library Extractor — bootstrap + tab routing
//
// Boots the Neutralino runtime, wires tab switching, and lazily loads each
// tab's controller module on first activation.

import { loadConfig, isConfigComplete } from './config.js';
import { initSetupWizard, runSetupWizard } from './setup.js';
import { initSettingsTab } from './settings.js';
import { initExtractTab } from './extractor.js';
import { initDiffTab } from './differ.js';
import { initPreviewTab } from './previewSubmit.js';
import { initIndexTab } from './indexBuilder.js';
import { initManageTab } from './manage.js';

const NEUTRALINO_AVAILABLE = typeof Neutralino !== 'undefined';

function setStatus(text) {
    const el = document.getElementById('app-footer-status');
    if (el) el.textContent = text;
}

function setupTabRouting() {
    const tabs = document.querySelectorAll('.app-tab');
    const panels = document.querySelectorAll('.tab-panel');
    const initialized = new Set();

    const loadTab = (id) => {
        if (initialized.has(id)) return;
        initialized.add(id);
        try {
            switch (id) {
                case 'extract':  initExtractTab();  break;
                case 'diff':     initDiffTab();     break;
                case 'preview':  initPreviewTab();  break;
                case 'manage':   initManageTab();   break;
                case 'index':    initIndexTab();    break;
                case 'settings': initSettingsTab(); break;
            }
        } catch (e) {
            console.error(`Failed to init tab ${id}:`, e);
        }
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const id = tab.getAttribute('data-tab');
            tabs.forEach(t => t.classList.toggle('active', t === tab));
            panels.forEach(p => p.classList.toggle('active', p.getAttribute('data-panel') === id));
            loadTab(id);
        });
    });

    // Pre-init the default (Extract) tab
    loadTab('extract');
}

async function bootstrap() {
    setStatus('Booting…');

    if (NEUTRALINO_AVAILABLE) {
        try {
            await Neutralino.init();
            Neutralino.events.on('windowClose', () => Neutralino.app.exit());
            setStatus('Ready');
        } catch (e) {
            console.error('Neutralino init failed:', e);
            setStatus(`Neutralino init error: ${e}`);
        }
    } else {
        setStatus('Running outside Neutralino — file/exec ops will fail');
        console.warn('Neutralino runtime not detected. Limited mode.');
    }

    // Load saved config (tool paths, hashes dir, repo path)
    await loadConfig();

    // Initialize the setup wizard module (registers handlers but doesn't show)
    initSetupWizard();

    // Wire tab routing (also pre-inits the Extract tab)
    setupTabRouting();

    // Show the wizard if config is incomplete
    if (!isConfigComplete()) {
        runSetupWizard();
    }
}

// ES module scripts are deferred, so by the time this runs the DOM is
// already parsed. DOMContentLoaded may have already fired — call bootstrap
// directly if so, otherwise wait.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap().catch(e => {
        console.error('Bootstrap failed:', e);
        const status = document.getElementById('app-footer-status');
        if (status) status.textContent = `Bootstrap error: ${e}`;
    });
}
