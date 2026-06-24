import { useEffect, useMemo, useState } from 'react';
import type {
  AppState,
  Course,
  FileAsset,
  McpRuntimeStatus,
  RecordingCandidate,
  SyncStatus,
  TranscriptJob,
  TranscriptionSettings,
  TranscriptionStatus,
  TranscriptionWorkerStatus,
} from '../shared/domain';
import { NotionSettingsPanel } from './NotionSettingsPanel';
import './app.css';

const STEPS = [
  'Willkommen',
  'Speicherort',
  'LearnWeb',
  'Kurse & Auswahl',
  'Transkription',
  'MCP (optional)',
  'Testlauf',
  'Sync-Modus',
] as const;

type DashboardTab = 'overview' | 'courses' | 'transcripts' | 'library' | 'settings';
type TestState = 'idle' | 'running' | 'success' | 'error';

const SYNC_INTERVAL_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: 'Alle 15 Minuten' },
  { minutes: 30, label: 'Alle 30 Minuten' },
  { minutes: 60, label: 'Stündlich' },
  { minutes: 240, label: 'Alle 4 Stunden' },
  { minutes: 1440, label: 'Täglich' },
];

const EMPTY_SYNC: SyncStatus = { state: 'idle', lastRun: null, activeJobs: 0 };
const EMPTY_TRANSCRIPTION: TranscriptionStatus = {
  phase: 'idle', activeJob: null, queued: 0, done: 0, failed: 0,
};
const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  mode: 'none', language: 'de', model: 'small',
};
const EMPTY_MCP: McpRuntimeStatus = {
  enabled: false, stdioRegistered: false, sseRunning: false, sseUrl: null,
  token: null, configuredAt: null, lastCheckedAt: null,
};

export function App(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [displayName, setDisplayName] = useState('Thomas');
  const [libraryPath, setLibraryPath] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginVerified, setLoginVerified] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(EMPTY_SYNC);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState<number | null>(null);
  const [editingSyncMode, setEditingSyncMode] = useState(false);
  const [transcriptionSettings, setTranscriptionSettings] = useState(DEFAULT_TRANSCRIPTION_SETTINGS);
  const [workerStatus, setWorkerStatus] = useState<TranscriptionWorkerStatus>({
    installed: false, backend: null, downloadedModels: [],
  });
  const [transcriptionStatus, setTranscriptionStatus] = useState(EMPTY_TRANSCRIPTION);
  const [recordings, setRecordings] = useState<RecordingCandidate[]>([]);
  const [selectedRecordingKeys, setSelectedRecordingKeys] = useState<Set<string>>(new Set());
  const [transcriptJobs, setTranscriptJobs] = useState<TranscriptJob[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpRuntimeStatus>(EMPTY_MCP);
  const [testState, setTestState] = useState<TestState>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.api.onSyncStatus((status) => {
      if (active) setSyncStatus(status);
      if (status.state !== 'syncing') void loadDashboardData();
    });
    const unsubscribeTranscription = window.api.onTranscriptionStatus((status) => {
      if (!active) return;
      setTranscriptionStatus(status);
      if (status.phase === 'idle' || status.phase === 'error') {
        void window.api.getTranscriptJobs().then(setTranscriptJobs);
      }
    });
    void Promise.all([
      window.api.getAppState(),
      window.api.getCourses(),
      window.api.getLibraryItems(),
      window.api.getSyncStatus(),
      window.api.getSettings(),
      window.api.getTranscriptionSettings(),
      window.api.getTranscriptionWorkerStatus(),
      window.api.getTranscriptJobs(),
      window.api.getMcpRuntimeStatus(),
    ]).then(([state, storedCourses, libraryItems, status, settings, transcription, worker, jobs, mcp]) => {
      if (!active) return;
      setAppState(state);
      setDisplayName(state.profile?.displayName ?? 'Thomas');
      setLibraryPath(state.libraryPath ?? '');
      setLoginVerified(state.hasCredentials);
      setCourses(storedCourses);
      setFiles(libraryItems);
      setSyncStatus(status);
      setSyncIntervalMinutes(settings.syncIntervalMinutes);
      setTranscriptionSettings(transcription);
      setWorkerStatus(worker);
      setTranscriptJobs(jobs);
      setMcpStatus(mcp);
      setLoading(false);
    }).catch((error: unknown) => {
      if (active) {
        setMessage(errorMessage(error));
        setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeTranscription();
    };
  }, []);

  const selectedCourses = courses.filter((course) => course.isSelected);

  async function loadDashboardData(): Promise<void> {
    try {
      const [storedCourses, libraryItems] = await Promise.all([
        window.api.getCourses(),
        window.api.getLibraryItems(),
      ]);
      setCourses(storedCourses);
      setFiles(libraryItems);
    } catch {
      // Live-Refresh ist best effort; der letzte sichtbare Stand bleibt erhalten.
    }
  }

  async function chooseLibrary(): Promise<void> {
    setMessage(null);
    const path = await window.api.chooseLibraryFolder();
    if (!path) return;
    const result = await window.api.setLibraryPath(path);
    if (!result.ok) {
      setMessage(result.reason ?? 'Der Ordner ist nicht beschreibbar.');
      return;
    }
    setLibraryPath(path);
  }

  async function saveLogin(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.api.saveCredentials({ username, password });
      if (!result.ok) throw new Error(result.message ?? 'Login fehlgeschlagen.');
      setLoginVerified(true);
      setPassword('');
      setAppState(await window.api.getAppState());
      await refreshCourses();
    } catch (error) {
      setLoginVerified(false);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshCourses(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      setCourses(await window.api.refreshCourses());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCourse(course: Course): Promise<void> {
    const selected = !course.isSelected;
    await window.api.setCourseSelected({ courseId: course.courseId, selected });
    setCourses((current) => current.map((item) =>
      item.courseId === course.courseId ? { ...item, isSelected: selected } : item));
  }

  async function runTest(): Promise<void> {
    setTestState('running');
    setMessage(null);
    try {
      const login = await window.api.verifyLogin();
      if (!login.ok) throw new Error(login.message ?? 'Login-Prüfung fehlgeschlagen.');
      const path = await window.api.checkLibraryPath(libraryPath);
      if (!path.ok) throw new Error(path.reason ?? 'Speicherort nicht beschreibbar.');
      const refreshed = await window.api.refreshCourses();
      setCourses(refreshed);
      if (!refreshed.some((course) => course.isSelected)) {
        throw new Error('Bitte mindestens einen Kurs auswählen.');
      }
      setTestState('success');
    } catch (error) {
      setTestState('error');
      setMessage(errorMessage(error));
    }
  }

  function nextStep(): void {
    setMessage(null);
    if (step === 1 && !libraryPath) return setMessage('Bitte zuerst einen Speicherort auswählen.');
    if (step === 2 && !loginVerified) return setMessage('Bitte den LearnWeb-Login erfolgreich prüfen.');
    if (step === 3 && selectedCourses.length === 0) return setMessage('Bitte mindestens einen Kurs auswählen.');
    if (step === 6 && testState !== 'success') return setMessage('Bitte zuerst den Testlauf erfolgreich abschließen.');
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  async function finishSetup(): Promise<void> {
    setBusy(true);
    try {
      const state = await window.api.completeSetup({ displayName });
      setAppState(state);
      setSyncStatus(await window.api.getSyncStatus());
      await loadDashboardData();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function startSync(): Promise<void> {
    setMessage(null);
    try {
      await window.api.startSync();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function saveTranscriptionSettings(settings: TranscriptionSettings): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      setTranscriptionSettings(await window.api.setTranscriptionSettings(settings));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSyncInterval(minutes: number): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await window.api.setSetting({ key: 'sync_interval_minutes', value: String(minutes) });
      setSyncIntervalMinutes(minutes);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function setupWorker(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      setWorkerStatus(await window.api.setupTranscriptionWorker());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function scanRecordings(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const found = await window.api.scanRecordings();
      setRecordings(found);
      setSelectedRecordingKeys(new Set(found.map((recording) => recording.recordingKey)));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function enqueueRecordings(keys?: string[]): Promise<void> {
    // Ohne explizite Keys (Bulk) wird die aktuelle Checkbox-Auswahl eingereiht.
    const recordingKeys = keys ?? [...selectedRecordingKeys];
    if (recordingKeys.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      setTranscriptJobs(await window.api.enqueueTranscriptions({ recordingKeys }));
      // Eingereihte Keys aus der Auswahl entfernen, damit keine Checkboxen selektiert
      // „hängen bleiben" – gilt für Inline-„Einreihen" wie für die Bulk-Aktion.
      setSelectedRecordingKeys((current) => {
        const next = new Set(current);
        for (const key of recordingKeys) next.delete(key);
        return next;
      });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function startTranscriptionQueue(): Promise<void> {
    await window.api.startTranscriptionQueue();
    setTranscriptJobs(await window.api.getTranscriptJobs());
  }

  async function cancelTranscription(): Promise<void> {
    await window.api.cancelTranscription();
    setTranscriptJobs(await window.api.getTranscriptJobs());
  }

  async function retryTranscription(jobId: number): Promise<void> {
    await window.api.retryTranscription({ jobId });
    await startTranscriptionQueue();
  }

  async function retryNotionPush(jobId: number): Promise<void> {
    setMessage(null);
    try {
      await window.api.retryNotionPush({ jobId });
      setTranscriptJobs(await window.api.getTranscriptJobs());
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function removeTranscription(jobId: number): Promise<void> {
    // Entfernt einen nicht-aktiven Job lokal aus der Queue (Backend lehnt aktive Jobs ab).
    setMessage(null);
    try {
      await window.api.removeTranscription({ jobId });
      setTranscriptJobs(await window.api.getTranscriptJobs());
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function setMcpEnabled(enabled: boolean): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const next = await window.api.setMcpEnabled({ enabled });
      setMcpStatus(next);
      setAppState((current) => current ? { ...current, mcpEnabled: next.enabled } : current);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateMcpToken(): Promise<void> {
    setMcpStatus(await window.api.regenerateMcpToken());
  }

  async function handleLogout(): Promise<void> {
    if (!confirm('Möchtest du dich wirklich abmelden? Deine Zugangsdaten werden gelöscht.')) return;
    setBusy(true);
    setMessage(null);
    try {
      await window.api.logout();
      setAppState(await window.api.getAppState());
      setLoginVerified(false);
      setMcpStatus(EMPTY_MCP);
      setUsername('');
      setPassword('');
      setStep(2);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="loading">UniCloudConnect wird geladen …</div>;
  if (!appState) return <div className="loading error">Die App konnte nicht initialisiert werden.</div>;

  if (!appState.isSetupComplete || !appState.hasCredentials) {
    return (
      <div className="setup-shell">
        <aside className="setup-sidebar">
          <Brand />
          <div className="step-list">
            {STEPS.map((label, index) => (
              <button
                className={index === step ? 'step active' : 'step'}
                key={label}
                type="button"
                onClick={() => index <= step && setStep(index)}
              >
                <span>{index + 1}</span>{label}
              </button>
            ))}
          </div>
          <div className="privacy-note">Lokal auf diesem Mac<br />Keine Cloud-Speicherung</div>
        </aside>
        <section className="setup-main">
          <div className="setup-content">
            <SetupStep
              step={step}
              displayName={displayName}
              setDisplayName={setDisplayName}
              libraryPath={libraryPath}
              chooseLibrary={chooseLibrary}
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              saveLogin={saveLogin}
              loginVerified={loginVerified}
              courses={courses}
              toggleCourse={toggleCourse}
              refreshCourses={refreshCourses}
              runTest={runTest}
              testState={testState}
              selectedCount={selectedCourses.length}
              busy={busy}
              finishSetup={finishSetup}
              transcriptionSettings={transcriptionSettings}
              saveTranscriptionSettings={saveTranscriptionSettings}
              workerStatus={workerStatus}
              setupWorker={setupWorker}
              mcpStatus={mcpStatus}
              setMcpEnabled={setMcpEnabled}
              syncIntervalMinutes={syncIntervalMinutes}
              saveSyncInterval={saveSyncInterval}
            />
            {message && <div className="notice error" role="alert">{message}</div>}
          </div>
          <footer className="setup-footer">
            <div className="progress"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
            <span>Schritt {step + 1} von {STEPS.length}</span>
            <div className="footer-actions">
              <button type="button" className="button secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Zurück</button>
              {step < STEPS.length - 1 && <button type="button" className="button primary" onClick={nextStep}>Weiter</button>}
            </div>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <Dashboard
      tab={tab}
      setTab={setTab}
      courses={courses}
      files={files}
      syncStatus={syncStatus}
      libraryPath={libraryPath}
      toggleCourse={toggleCourse}
      refreshCourses={refreshCourses}
      startSync={startSync}
      message={message}
      busy={busy}
      transcriptionSettings={transcriptionSettings}
      saveTranscriptionSettings={saveTranscriptionSettings}
      workerStatus={workerStatus}
      setupWorker={setupWorker}
      transcriptionStatus={transcriptionStatus}
      recordings={recordings}
      selectedRecordingKeys={selectedRecordingKeys}
      setSelectedRecordingKeys={setSelectedRecordingKeys}
      transcriptJobs={transcriptJobs}
      scanRecordings={scanRecordings}
      enqueueRecordings={enqueueRecordings}
      startTranscriptionQueue={startTranscriptionQueue}
      cancelTranscription={cancelTranscription}
      retryTranscription={retryTranscription}
      retryNotionPush={retryNotionPush}
      removeTranscription={removeTranscription}
      mcpStatus={mcpStatus}
      setMcpEnabled={setMcpEnabled}
      regenerateMcpToken={regenerateMcpToken}
      handleLogout={handleLogout}
      syncIntervalMinutes={syncIntervalMinutes}
      saveSyncInterval={saveSyncInterval}
      editingSyncMode={editingSyncMode}
      setEditingSyncMode={setEditingSyncMode}
    />
  );
}

interface SetupStepProps {
  step: number;
  displayName: string;
  setDisplayName(value: string): void;
  libraryPath: string;
  chooseLibrary(): Promise<void>;
  username: string;
  setUsername(value: string): void;
  password: string;
  setPassword(value: string): void;
  saveLogin(): Promise<void>;
  loginVerified: boolean;
  courses: Course[];
  toggleCourse(course: Course): Promise<void>;
  refreshCourses(): Promise<void>;
  runTest(): Promise<void>;
  testState: TestState;
  selectedCount: number;
  busy: boolean;
  finishSetup(): Promise<void>;
  transcriptionSettings: TranscriptionSettings;
  saveTranscriptionSettings(settings: TranscriptionSettings): Promise<void>;
  workerStatus: TranscriptionWorkerStatus;
  setupWorker(): Promise<void>;
  mcpStatus: McpRuntimeStatus;
  setMcpEnabled(enabled: boolean): Promise<void>;
  syncIntervalMinutes: number | null;
  saveSyncInterval(minutes: number): Promise<void>;
}

function SetupStep(props: SetupStepProps): React.JSX.Element {
  const headings = [
    'Willkommen bei UniCloudConnect', 'Wo sollen deine Dateien liegen?', 'Mit LearnWeb verbinden',
    'Kurse & Inhalte auswählen', 'Lokale Transkription', 'MCP für Claude und Codex',
    'Erster Testlauf', 'Wann soll synchronisiert werden?',
  ];
  return (
    <div className="step-panel">
      <div className="eyebrow">Schritt {props.step + 1}{props.step === 4 || props.step === 5 ? ' · optional' : ''}</div>
      <h1>{headings[props.step]}</h1>
      {props.step === 0 && <>
        <p>UniCloudConnect synchronisiert deine LearnWeb-Kursdateien lokal auf diesen Mac. Ohne Cloud-Zwischenspeicher und mit rein lesendem LearnWeb-Zugriff.</p>
        <label>Anzeigename<input value={props.displayName} onChange={(event) => props.setDisplayName(event.target.value)} /></label>
        <FeatureGrid items={['Lokale Kursbibliothek', 'macOS-Schlüsselbund', 'Read-only LearnWeb', 'Statusbar-Sync']} />
      </>}
      {props.step === 1 && <>
        <p>Hier landen Kursdateien und spätere Markdown-Transkripte. Die App prüft den Ordner mit einer echten Schreibprobe.</p>
        <div className="path-card"><div><strong>Speicherort</strong><span>{props.libraryPath || 'Noch nicht gewählt'}</span></div><button className="button secondary" type="button" onClick={() => void props.chooseLibrary()}>Ordner wählen</button></div>
        <div className="notice">Nichts aus diesem Ordner verlässt deinen Mac.</div>
      </>}
      {props.step === 2 && <>
        <p>Deine Zugangsdaten werden ausschließlich im macOS-Schlüsselbund gespeichert und direkt gegen das Uni-Münster-LearnWeb geprüft.</p>
        <div className="form-grid">
          <label>Benutzername<input autoComplete="username" value={props.username} onChange={(event) => props.setUsername(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !props.busy && props.username && props.password) { void props.saveLogin(); } }} /></label>
          <label>Passwort<input autoComplete="current-password" type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !props.busy && props.username && props.password) { void props.saveLogin(); } }} /></label>
        </div>
        <button className="button primary" type="button" disabled={props.busy || !props.username || !props.password} onClick={() => void props.saveLogin()}>{props.busy ? 'Prüfe …' : 'Login prüfen und sicher speichern'}</button>
        {props.loginVerified && <div className="notice success">Login erfolgreich geprüft. Zugangsdaten liegen im Schlüsselbund.</div>}
      </>}
      {props.step === 3 && <>
        <div className="split-heading"><p>Wähle ganze Kurse für den automatischen Datei-Sync.</p><button className="text-button" type="button" onClick={() => void props.refreshCourses()}>Kursliste aktualisieren</button></div>
        <CourseList courses={props.courses} toggleCourse={props.toggleCourse} />
        <div className="muted">{props.selectedCount} von {props.courses.length} Kursen ausgewählt</div>
      </>}
      {props.step === 4 && <>
        <p>Aufzeichnungen werden ausschließlich auf diesem Mac verarbeitet und als Markdown in der Kursbibliothek gespeichert.</p>
        <div className="option-stack">
          {(['none', 'manual', 'auto'] as const).map((mode) => (
            <OptionCard
              key={mode}
              title={({ none: 'Keine Transkription', manual: 'Manuell starten', auto: 'Automatisch einreihen' })[mode]}
              text={({ none: 'Nur Kursdateien synchronisieren.', manual: 'Aufzeichnungen im Dashboard auswählen.', auto: 'Neue Aufzeichnungen automatisch vorbereiten.' })[mode]}
              selected={props.transcriptionSettings.mode === mode}
              onClick={() => void props.saveTranscriptionSettings({ ...props.transcriptionSettings, mode })}
            />
          ))}
        </div>
        {props.transcriptionSettings.mode !== 'none' && <>
          <div className="form-grid compact">
            <label>Sprache<select value={props.transcriptionSettings.language} onChange={(event) => void props.saveTranscriptionSettings({ ...props.transcriptionSettings, language: event.target.value as TranscriptionSettings['language'] })}><option value="de">Deutsch</option><option value="en">Englisch</option><option value="auto">Automatisch</option></select></label>
            <label>Modell<select value={props.transcriptionSettings.model} onChange={(event) => void props.saveTranscriptionSettings({ ...props.transcriptionSettings, model: event.target.value as TranscriptionSettings['model'] })}><option value="base">Base</option><option value="small">Small</option><option value="large-v3-turbo">Large v3 Turbo</option></select></label>
          </div>
          <div className={props.workerStatus.installed ? 'notice success' : 'notice'}>
            Worker: {props.workerStatus.installed ? `bereit (${props.workerStatus.backend ?? 'lokal'})` : 'noch nicht eingerichtet'}
          </div>
          {!props.workerStatus.installed && <button className="button secondary" type="button" disabled={props.busy} onClick={() => void props.setupWorker()}>Lokalen Worker einrichten</button>}
        </>}
      </>}
      {props.step === 5 && <>
        <p>MCP ermöglicht KI-Agenten kontoweiten, strikt lesenden Zugriff auf LearnWeb. Die Funktion bleibt opt-in und wird nie still aktiviert.</p>
        <div className="notice purple"><strong>Wichtig:</strong> MCP ist nicht auf deine Sync-Auswahl begrenzt. SSE bindet ausschließlich an 127.0.0.1 und ist mit einem Token geschützt.</div>
        <OptionCard title="MCP deaktiviert" text="Kein Agentenzugriff." selected={!props.mcpStatus.enabled} onClick={() => void props.setMcpEnabled(false)} />
        <OptionCard title="MCP aktivieren" text="Claude Desktop (stdio) und lokaler SSE-Endpunkt." selected={props.mcpStatus.enabled} onClick={() => void props.setMcpEnabled(true)} />
        {props.mcpStatus.enabled && <McpConnectionDetails status={props.mcpStatus} />}
      </>}
      {props.step === 6 && <>
        <p>Wir prüfen Login, Kursliste, Auswahl und Schreibrechte gemeinsam.</p>
        <button className="button primary" type="button" disabled={props.testState === 'running'} onClick={() => void props.runTest()}>{props.testState === 'running' ? 'Testlauf läuft …' : 'Testlauf starten'}</button>
        {props.testState === 'success' && <div className="notice success">Alles bereit. {props.selectedCount} Kurse sind für den Sync ausgewählt.</div>}
        {props.testState === 'error' && <div className="notice error">Der Testlauf ist noch nicht vollständig erfolgreich.</div>}
      </>}
      {props.step === 7 && <>
        <p>Login-Start beim Systemstart folgt separat.</p>
        <OptionCard
          title="Nur manuell"
          text="Du startest jeden Sync im Dashboard selbst."
          selected={!props.syncIntervalMinutes}
          onClick={() => void props.saveSyncInterval(0)}
        />
        <OptionCard
          title="Automatischer Hintergrundsync"
          text="Die App synchronisiert in einem festen Intervall im Hintergrund."
          selected={!!props.syncIntervalMinutes}
          onClick={() => void props.saveSyncInterval(30)}
        />
        {!!props.syncIntervalMinutes && (
          <label>Intervall
            <select
              value={props.syncIntervalMinutes}
              onChange={(event) => void props.saveSyncInterval(Number(event.target.value))}
            >
              {SYNC_INTERVAL_OPTIONS.map((option) => (
                <option key={option.minutes} value={option.minutes}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        <button className="button primary wide" type="button" disabled={props.busy} onClick={() => void props.finishSetup()}>Einrichtung abschließen & Dashboard öffnen</button>
      </>}
    </div>
  );
}

function Dashboard(props: {
  tab: DashboardTab;
  setTab(tab: DashboardTab): void;
  courses: Course[];
  files: FileAsset[];
  syncStatus: SyncStatus;
  libraryPath: string;
  toggleCourse(course: Course): Promise<void>;
  refreshCourses(): Promise<void>;
  startSync(): Promise<void>;
  message: string | null;
  busy: boolean;
  transcriptionSettings: TranscriptionSettings;
  saveTranscriptionSettings(settings: TranscriptionSettings): Promise<void>;
  workerStatus: TranscriptionWorkerStatus;
  setupWorker(): Promise<void>;
  transcriptionStatus: TranscriptionStatus;
  recordings: RecordingCandidate[];
  selectedRecordingKeys: Set<string>;
  setSelectedRecordingKeys(keys: Set<string>): void;
  transcriptJobs: TranscriptJob[];
  scanRecordings(): Promise<void>;
  enqueueRecordings(keys?: string[]): Promise<void>;
  startTranscriptionQueue(): Promise<void>;
  cancelTranscription(): Promise<void>;
  retryTranscription(jobId: number): Promise<void>;
  retryNotionPush(jobId: number): Promise<void>;
  removeTranscription(jobId: number): Promise<void>;
  mcpStatus: McpRuntimeStatus;
  setMcpEnabled(enabled: boolean): Promise<void>;
  regenerateMcpToken(): Promise<void>;
  handleLogout(): Promise<void>;
  syncIntervalMinutes: number | null;
  saveSyncInterval(minutes: number): Promise<void>;
  editingSyncMode: boolean;
  setEditingSyncMode(value: boolean): void;
}): React.JSX.Element {
  const selected = props.courses.filter((course) => course.isSelected).length;
  return <div className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Brand />
      <div className={`connection ${props.syncStatus.state}`}><span />
        <div><strong>{statusLabel(props.syncStatus.state)}</strong><small>{props.syncStatus.message ?? 'Bereit'}</small></div>
      </div>
      {([
        ['overview', 'Übersicht'], ['courses', 'Kurse'], ['transcripts', 'Transkriptionen'],
        ['library', 'Bibliothek'], ['settings', 'Einstellungen'],
      ] as Array<[DashboardTab, string]>).map(([id, label]) =>
        <button key={id} type="button" className={props.tab === id ? 'nav active' : 'nav'} onClick={() => props.setTab(id)}>{label}</button>)}
      <div className="sidebar-foot">MCP {props.mcpStatus.enabled ? 'aktiv' : 'inaktiv'}<br /><small>lokal · read-only</small></div>
    </aside>
    <main className="dashboard-main">
      <header><div><h2>{dashboardTitle(props.tab)}</h2><p>{props.syncStatus.lastRun?.finishedAt ? `Letzter Sync: ${formatDate(props.syncStatus.lastRun.finishedAt)}` : 'Noch kein vollständiger Sync'}</p></div>
        {props.tab === 'overview' && <button className="button primary" type="button" disabled={props.syncStatus.state === 'syncing'} onClick={() => void props.startSync()}>{props.syncStatus.state === 'syncing' ? 'Synchronisiere …' : 'Jetzt synchronisieren'}</button>}
      </header>
      <section className="dashboard-content">
        {props.message && <div className="notice error">{props.message}</div>}
        {props.tab === 'overview' && <>
          <div className="metric-grid">
            <Metric label="Verbindung" value={props.syncStatus.state === 'error' ? 'Fehler' : 'Bereit'} />
            <Metric label="Kurse" value={String(selected)} suffix="ausgewählt" />
            <Metric label="Bibliothek" value={String(props.files.length)} suffix="Dateien" />
            <Metric label="Aktive Jobs" value={String(props.syncStatus.activeJobs)} />
          </div>
          <div className="panel"><h3>Lokale Bibliothek</h3><p>{props.libraryPath || 'Kein Pfad konfiguriert'}</p><button className="text-button" type="button" onClick={() => void window.api.openLibraryFolder()}>Im Finder öffnen</button></div>
        </>}
        {props.tab === 'courses' && <><div className="split-heading"><p>{selected} Kurse werden synchronisiert.</p><button className="button secondary" type="button" disabled={props.busy} onClick={() => void props.refreshCourses()}>Aktualisieren</button></div><CourseList courses={props.courses} toggleCourse={props.toggleCourse} /></>}
        {props.tab === 'transcripts' && <TranscriptionPanel {...props} />}
        {props.tab === 'library' && (props.files.length ? <div className="file-list">{props.files.map((file) => <div key={file.id}><div><strong>{file.filenameLocal}</strong><span>{file.localPath}</span></div><small>{formatBytes(file.sizeBytes)} · {file.status}</small></div>)}</div> : <EmptyState title="Noch keine Dateien" text="Starte den ersten Sync, um die lokale Bibliothek zu füllen." />)}
        {props.tab === 'settings' && <div className="panel settings"><h3>Speicherort</h3><p>{props.libraryPath}</p><h3>Synchronisation</h3><SyncModeSettings {...props} /><h3>Transkription</h3><p>Modus: {props.transcriptionSettings.mode} · Modell: {props.transcriptionSettings.model} · Worker: {props.workerStatus.installed ? 'bereit' : 'nicht eingerichtet'}</p>{!props.workerStatus.installed && <button className="button secondary" type="button" onClick={() => void props.setupWorker()}>Worker einrichten</button>}<h3>MCP</h3><button className={props.mcpStatus.enabled ? 'button secondary' : 'button primary'} type="button" disabled={props.busy} onClick={() => void props.setMcpEnabled(!props.mcpStatus.enabled)}>{props.mcpStatus.enabled ? 'MCP deaktivieren' : 'MCP aktivieren'}</button>{props.mcpStatus.enabled && <><McpConnectionDetails status={props.mcpStatus} /><button className="text-button" type="button" onClick={() => void props.regenerateMcpToken()}>Bearer-Token erneuern</button></>}<h3>Notion-Anbindung</h3><NotionSettingsPanel /><h3>Konto</h3><button className="button danger" type="button" disabled={props.busy} onClick={() => void props.handleLogout()}>Abmelden</button><p><small>Entfernt die gespeicherten Zugangsdaten aus der Keychain und deaktiviert MCP.</small></p></div>}
      </section>
    </main>
  </div>;
}

function TranscriptionPanel(props: {
  busy: boolean;
  workerStatus: TranscriptionWorkerStatus;
  transcriptionStatus: TranscriptionStatus;
  recordings: RecordingCandidate[];
  selectedRecordingKeys: Set<string>;
  setSelectedRecordingKeys(keys: Set<string>): void;
  transcriptJobs: TranscriptJob[];
  scanRecordings(): Promise<void>;
  enqueueRecordings(keys?: string[]): Promise<void>;
  startTranscriptionQueue(): Promise<void>;
  cancelTranscription(): Promise<void>;
  retryTranscription(jobId: number): Promise<void>;
  retryNotionPush(jobId: number): Promise<void>;
  removeTranscription(jobId: number): Promise<void>;
}): React.JSX.Element {
  const toggleRecording = (key: string): void => {
    const next = new Set(props.selectedRecordingKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    props.setSelectedRecordingKeys(next);
  };

  const counts = useMemo(() => {
    let active = 0;
    let waiting = 0;
    let done = 0;
    let failed = 0;
    for (const job of props.transcriptJobs) {
      if (job.status === 'pending') {
        waiting++;
      } else if (job.status === 'done') {
        done++;
      } else if (job.status === 'failed_retryable' || job.status === 'failed_permanent') {
        failed++;
      } else if (
        job.status === 'claimed' ||
        job.status === 'downloading_media' ||
        job.status === 'media_downloaded' ||
        job.status === 'transcribing' ||
        job.status === 'markdown_created'
      ) {
        active++;
      }
    }
    return { active, waiting, done, failed };
  }, [props.transcriptJobs]);

  const groups = useMemo(() => {
    const jobs = props.transcriptJobs;
    const recordings = props.recordings;

    const active: Array<{ job: TranscriptJob }> = [];
    const waiting: Array<{ job: TranscriptJob }> = [];
    const attention: Array<{ job: TranscriptJob }> = [];
    const finished: Array<{ job: TranscriptJob }> = [];

    for (const job of jobs) {
      const status = job.status;
      if (
        status === 'claimed' ||
        status === 'downloading_media' ||
        status === 'media_downloaded' ||
        status === 'transcribing' ||
        status === 'markdown_created'
      ) {
        active.push({ job });
      } else if (status === 'pending') {
        waiting.push({ job });
      } else if (status === 'failed_retryable' || status === 'failed_permanent') {
        attention.push({ job });
      } else if (status === 'done') {
        finished.push({ job });
      }
    }

    const available = recordings.filter(
      (r) => !jobs.some((j) => j.recordingKey === r.recordingKey)
    );

    return { active, waiting, attention, finished, available };
  }, [props.transcriptJobs, props.recordings]);

  const formatStatusText = (status: string): string => {
    switch (status) {
      case 'claimed': return 'Warteschlange betreten';
      case 'downloading_media': return 'Medien-Download läuft';
      case 'media_downloaded': return 'Medium lokal bereitgestellt';
      case 'transcribing': return 'Transkription läuft';
      case 'markdown_created': return 'Markdown wird generiert';
      case 'pending': return 'Wartet';
      case 'done': return 'Fertig';
      case 'failed_retryable': return 'Fehlgeschlagen (wiederholbar)';
      case 'failed_permanent': return 'Fehlgeschlagen (permanent)';
      default: return status;
    }
  };

  const hasAnyItems =
    groups.active.length > 0 ||
    groups.waiting.length > 0 ||
    groups.attention.length > 0 ||
    groups.finished.length > 0 ||
    groups.available.length > 0;

  return <>
    <div className="split-heading sticky-header">
      <div>
        <p>Worker: {props.workerStatus.installed ? `bereit (${props.workerStatus.backend ?? 'lokal'})` : 'nicht eingerichtet'}</p>
        <small className="muted">
          Aktiv: {counts.active} · Wartet: {counts.waiting} · Fertig: {counts.done} · Fehler: {counts.failed}
        </small>
      </div>
      <div className="action-row">
        <button className="button secondary" type="button" disabled={props.busy} onClick={() => void props.scanRecordings()}>
          Aufzeichnungen scannen
        </button>
        {props.transcriptionStatus.activeJob ? (
          <button className="button secondary" type="button" disabled={props.busy} onClick={() => void props.cancelTranscription()}>
            Abbrechen
          </button>
        ) : (
          <button className="button primary" type="button" disabled={props.busy || counts.waiting === 0} onClick={() => void props.startTranscriptionQueue()}>
            Queue starten
          </button>
        )}
      </div>
    </div>

    {hasAnyItems ? (
      <div className="transcription-unified-list">
        {groups.active.length > 0 && (
          <div className="group-section">
            <h4 className="group-title">Aktiv ({groups.active.length})</h4>
            <div className="group-items">
              {groups.active.map(({ job }) => {
                const isActive = props.transcriptionStatus.activeJob?.id === job.id;
                const progress = isActive ? props.transcriptionStatus.progress : null;
                const message = isActive
                  ? (props.transcriptionStatus.message ?? props.transcriptionStatus.phase)
                  : formatStatusText(job.status);
                const percent = progress && progress.total > 0
                  ? Math.round((progress.done / progress.total) * 100)
                  : null;

                return (
                  <div key={job.id} className="transcription-item active-item">
                    <div className="item-info">
                      <span className="status-dot pulsing" />
                      <div className="item-details">
                        <strong>{job.title ?? `Job ${job.id}`}</strong>
                        <small>{job.sectionName ?? 'Ohne Abschnitt'} · {message}</small>
                      </div>
                    </div>
                    {percent !== null && (
                      <div className="item-progress">
                        <div className="progress-bar-container">
                          <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="progress-percent">{percent}%</span>
                      </div>
                    )}
                    <div className="item-actions">
                      <button className="text-button cancel" type="button" disabled={props.busy} onClick={() => void props.cancelTranscription()}>
                        Abbrechen
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {groups.waiting.length > 0 && (
          <div className="group-section">
            <h4 className="group-title">Wartet ({groups.waiting.length})</h4>
            <div className="group-items">
              {groups.waiting.map(({ job }) => (
                <div key={job.id} className="transcription-item waiting-item">
                  <div className="item-info">
                    <span className="status-dot waiting" />
                    <div className="item-details">
                      <strong>{job.title ?? `Job ${job.id}`}</strong>
                      <small>{job.sectionName ?? 'Ohne Abschnitt'} · Wartet in Warteschlange</small>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="text-button remove" type="button" disabled={props.busy} onClick={() => void props.removeTranscription(job.id)}>
                      Entfernen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {groups.attention.length > 0 && (
          <div className="group-section">
            <h4 className="group-title">Braucht Aufmerksamkeit ({groups.attention.length})</h4>
            <div className="group-items">
              {groups.attention.map(({ job }) => (
                <div key={job.id} className="transcription-item attention-item">
                  <div className="item-info">
                    <span className="status-dot error" />
                    <div className="item-details">
                      <strong>{job.title ?? `Job ${job.id}`}</strong>
                      <small className="error-message">
                        {job.sectionName ?? 'Ohne Abschnitt'} · Fehler: {job.errorCode ?? 'Unbekannter Fehler'}
                      </small>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="text-button retry" type="button" disabled={props.busy} onClick={() => void props.retryTranscription(job.id)}>
                      Wiederholen
                    </button>
                    <button className="text-button remove" type="button" disabled={props.busy} onClick={() => void props.removeTranscription(job.id)}>
                      Entfernen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {groups.finished.length > 0 && (
          <div className="group-section">
            <h4 className="group-title">Fertig ({groups.finished.length})</h4>
            <div className="group-items">
              {groups.finished.map(({ job }) => (
                <div key={job.id} className="transcription-item finished-item">
                  <div className="item-info">
                    <span className="status-dot done" />
                    <div className="item-details">
                      <strong>{job.title ?? `Job ${job.id}`}</strong>
                      <small>{job.sectionName ?? 'Ohne Abschnitt'} · Abgeschlossen · {job.model ?? 'Modell unbekannt'}</small>
                      {job.notionPushStatus === 'failed' && (
                        <small className="notion-push-failed">
                          ⚠ Notion: nicht gepusht — {job.notionPushError ?? 'Unbekannter Fehler'}
                        </small>
                      )}
                      {job.notionPushStatus === 'warnings' && (
                        <small className="notion-push-warning">
                          Notion: gepusht, Properties übersprungen — {job.notionPushError ?? 'Details unbekannt'}
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="item-actions">
                    {job.transcriptLocalPath && (
                      <button className="text-button open" type="button" onClick={() => void window.api.openTranscript({ jobId: job.id })}>
                        Öffnen
                      </button>
                    )}
                    {job.notionPushStatus === 'failed' && job.pendingLocalPath && (
                      <button className="text-button retry-notion" type="button" disabled={props.busy} onClick={() => void props.retryNotionPush(job.id)}>
                        Erneut an Notion senden
                      </button>
                    )}
                    <button className="text-button remove" type="button" disabled={props.busy} onClick={() => void props.removeTranscription(job.id)}>
                      Entfernen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {groups.available.length > 0 && (
          <div className="group-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 className="group-title" style={{ margin: 0 }}>Verfügbar ({groups.available.length})</h4>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="text-button"
                  style={{ fontSize: '12px' }}
                  type="button"
                  onClick={() => props.setSelectedRecordingKeys(new Set(groups.available.map((r) => r.recordingKey)))}
                >
                  Alle auswählen
                </button>
                <span style={{ color: '#d2d2d6', fontSize: '12px' }}>|</span>
                <button
                  className="text-button"
                  style={{ fontSize: '12px' }}
                  type="button"
                  onClick={() => props.setSelectedRecordingKeys(new Set())}
                >
                  Auswahl aufheben
                </button>
              </div>
            </div>

            {props.selectedRecordingKeys.size > 0 && (
              <div className="selection-bar">
                <span>{props.selectedRecordingKeys.size} Aufzeichnungen ausgewählt</span>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="button primary small" type="button" disabled={props.busy} onClick={() => void props.enqueueRecordings()}>
                    Auswahl einreihen
                  </button>
                  <button className="button secondary small" type="button" onClick={() => props.setSelectedRecordingKeys(new Set())}>
                    Auswahl aufheben
                  </button>
                </div>
              </div>
            )}

            <div className="group-items available-list">
              {groups.available.map((recording) => (
                <div
                  key={recording.recordingKey}
                  className="transcription-item available-item clickable"
                  onClick={() => toggleRecording(recording.recordingKey)}
                >
                  <span className={props.selectedRecordingKeys.has(recording.recordingKey) ? 'check checked' : 'check'}>
                    {props.selectedRecordingKeys.has(recording.recordingKey) ? '✓' : ''}
                  </span>
                  <div className="item-info">
                    <div className="item-details">
                      <strong>{recording.title}</strong>
                      <small>{recording.sourceKind} · {recording.sectionName ?? 'Ohne Abschnitt'}</small>
                    </div>
                  </div>
                  <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="text-button enqueue"
                      type="button"
                      disabled={props.busy}
                      onClick={() => void props.enqueueRecordings([recording.recordingKey])}
                    >
                      Einreihen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : (
      <EmptyState
        title="Noch keine Transkripte"
        text="Scanne ausgewählte Kurse nach Aufzeichnungen und reihe sie anschließend ein."
      />
    )}
  </>;
}

function SyncModeSettings(props: {
  syncIntervalMinutes: number | null;
  saveSyncInterval(minutes: number): Promise<void>;
  editingSyncMode: boolean;
  setEditingSyncMode(value: boolean): void;
  busy: boolean;
}): React.JSX.Element {
  const currentLabel = props.syncIntervalMinutes
    ? SYNC_INTERVAL_OPTIONS.find((option) => option.minutes === props.syncIntervalMinutes)?.label
      ?? `Alle ${props.syncIntervalMinutes} Minuten`
    : 'Nur manuell';
  return <>
    <p>{currentLabel} <button className="text-button" type="button" onClick={() => props.setEditingSyncMode(!props.editingSyncMode)}>Ändern</button></p>
    {props.editingSyncMode && <>
      <OptionCard
        title="Nur manuell"
        text="Du startest jeden Sync im Dashboard selbst."
        selected={!props.syncIntervalMinutes}
        onClick={() => void props.saveSyncInterval(0)}
      />
      <OptionCard
        title="Automatischer Hintergrundsync"
        text="Die App synchronisiert in einem festen Intervall im Hintergrund."
        selected={!!props.syncIntervalMinutes}
        onClick={() => void props.saveSyncInterval(30)}
      />
      {!!props.syncIntervalMinutes && (
        <label>Intervall
          <select
            value={props.syncIntervalMinutes}
            disabled={props.busy}
            onChange={(event) => void props.saveSyncInterval(Number(event.target.value))}
          >
            {SYNC_INTERVAL_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>{option.label}</option>
            ))}
          </select>
        </label>
      )}
    </>}
  </>;
}

function McpConnectionDetails({ status }: { status: McpRuntimeStatus }): React.JSX.Element {
  return <div className="connection-details">
    <div><strong>Claude Desktop</strong><span>{status.stdioRegistered ? 'Konfiguriert' : 'Nicht konfiguriert'}</span></div>
    <div><strong>Lokaler SSE-Endpunkt</strong><code>{status.sseUrl ?? 'Nicht aktiv'}</code></div>
    <div><strong>Bearer-Token</strong><code>{status.token ?? 'Nicht verfügbar'}</code></div>
    <p>Cloud-Clients erreichen 127.0.0.1 nicht direkt. Ein Tunnel darf nur bewusst eingerichtet werden; URL und Token sind dann wie Zugangsdaten zu behandeln.</p>
  </div>;
}

function Brand(): React.JSX.Element { return <div className="brand"><span>UC</span><strong>UniCloudConnect</strong></div>; }
function FeatureGrid({ items }: { items: string[] }): React.JSX.Element { return <div className="feature-grid">{items.map((item) => <div key={item}>{item}</div>)}</div>; }
function OptionCard({ title, text, selected, disabled, onClick }: { title: string; text: string; selected?: boolean; disabled?: boolean; onClick?: () => void }): React.JSX.Element { return <button type="button" disabled={disabled} onClick={onClick} className={`option-card${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}><span className="radio" /><span><strong>{title}</strong><p>{text}</p></span></button>; }
function CourseList({ courses, toggleCourse }: { courses: Course[]; toggleCourse(course: Course): Promise<void> }): React.JSX.Element { return <div className="course-list">{courses.length ? courses.map((course) => <button type="button" key={course.courseId} onClick={() => void toggleCourse(course)}><span className={course.isSelected ? 'check checked' : 'check'}>{course.isSelected ? '✓' : ''}</span><div><strong>{course.fullname}</strong><small>{course.semester ?? course.shortname ?? `Kurs ${course.courseId}`}</small></div></button>) : <div className="empty-inline">Noch keine Kurse geladen.</div>}</div>; }
function Metric({ label, value, suffix }: { label: string; value: string; suffix?: string }): React.JSX.Element { return <div className="metric"><small>{label}</small><strong>{value}</strong>{suffix && <span>{suffix}</span>}</div>; }
function EmptyState({ title, text }: { title: string; text: string }): React.JSX.Element { return <div className="empty-state"><div>UC</div><h3>{title}</h3><p>{text}</p></div>; }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unbekannter Fehler.'; }
function statusLabel(status: SyncStatus['state']): string { return ({ idle: 'Bereit', syncing: 'Synchronisiert', transcribing: 'Transkribiert', error: 'Fehler', needs_setup: 'Einrichtung nötig' })[status]; }
function dashboardTitle(tab: DashboardTab): string { return ({ overview: 'Übersicht', courses: 'Kurse & Auswahl', transcripts: 'Transkriptionen', library: 'Lokale Bibliothek', settings: 'Einstellungen' })[tab]; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function formatBytes(value: number | null): string { if (value === null) return 'Größe unbekannt'; if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }
