import { useEffect, useState } from 'react';
import type { AppState, Course, FileAsset, SyncStatus } from '../shared/domain';
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

const EMPTY_SYNC: SyncStatus = { state: 'idle', lastRun: null, activeJobs: 0 };

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
  const [testState, setTestState] = useState<TestState>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.api.onSyncStatus((status) => {
      if (active) setSyncStatus(status);
      if (status.state !== 'syncing') void loadDashboardData();
    });
    void Promise.all([
      window.api.getAppState(),
      window.api.getCourses(),
      window.api.getLibraryItems(),
      window.api.getSyncStatus(),
    ]).then(([state, storedCourses, libraryItems, status]) => {
      if (!active) return;
      setAppState(state);
      setDisplayName(state.profile?.displayName ?? 'Thomas');
      setLibraryPath(state.libraryPath ?? '');
      setLoginVerified(state.hasCredentials);
      setCourses(storedCourses);
      setFiles(libraryItems);
      setSyncStatus(status);
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

  if (loading) return <div className="loading">UniCloudConnect wird geladen …</div>;
  if (!appState) return <div className="loading error">Die App konnte nicht initialisiert werden.</div>;

  if (!appState.isSetupComplete) {
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
          <label>Benutzername<input autoComplete="username" value={props.username} onChange={(event) => props.setUsername(event.target.value)} /></label>
          <label>Passwort<input autoComplete="current-password" type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} /></label>
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
        <p>Aufzeichnungen werden in einem späteren Schnitt lokal in Markdown umgewandelt. Für MVP 1 bleibt diese Funktion bewusst deaktiviert.</p>
        <OptionCard title="Keine Transkription" text="Nur unterstützte Kursdateien herunterladen." selected />
        <OptionCard title="Lokale Transkription" text="Noch nicht verfügbar." disabled />
      </>}
      {props.step === 5 && <>
        <p>MCP ermöglicht lokalen KI-Agenten kontoweiten, read-only Zugriff auf LearnWeb. Die Einrichtung folgt in einem späteren Schnitt und wird nie still aktiviert.</p>
        <div className="notice purple"><strong>Wichtig:</strong> MCP wäre nicht auf deine Sync-Auswahl begrenzt. Aktueller Status: inaktiv.</div>
        <OptionCard title="MCP deaktiviert lassen" text="Empfohlener Zustand für diesen Vertikalschnitt." selected />
      </>}
      {props.step === 6 && <>
        <p>Wir prüfen Login, Kursliste, Auswahl und Schreibrechte gemeinsam.</p>
        <button className="button primary" type="button" disabled={props.testState === 'running'} onClick={() => void props.runTest()}>{props.testState === 'running' ? 'Testlauf läuft …' : 'Testlauf starten'}</button>
        {props.testState === 'success' && <div className="notice success">Alles bereit. {props.selectedCount} Kurse sind für den Sync ausgewählt.</div>}
        {props.testState === 'error' && <div className="notice error">Der Testlauf ist noch nicht vollständig erfolgreich.</div>}
      </>}
      {props.step === 7 && <>
        <p>Der manuelle Sync ist in diesem Vertikalschnitt aktiv. Scheduler und Login-Start folgen separat.</p>
        <OptionCard title="Nur manuell" text="Du startest jeden Sync im Dashboard selbst." selected />
        <OptionCard title="Automatischer Hintergrundsync" text="Noch nicht verfügbar." disabled />
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
      <div className="sidebar-foot">MCP inaktiv<br /><small>lokal · read-only</small></div>
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
        {props.tab === 'transcripts' && <EmptyState title="Transkription folgt" text="Dieser Vertikalschnitt synchronisiert Dateien. Der lokale Worker wird später angebunden." />}
        {props.tab === 'library' && (props.files.length ? <div className="file-list">{props.files.map((file) => <div key={file.id}><div><strong>{file.filenameLocal}</strong><span>{file.localPath}</span></div><small>{formatBytes(file.sizeBytes)} · {file.status}</small></div>)}</div> : <EmptyState title="Noch keine Dateien" text="Starte den ersten Sync, um die lokale Bibliothek zu füllen." />)}
        {props.tab === 'settings' && <div className="panel settings"><h3>Speicherort</h3><p>{props.libraryPath}</p><h3>Synchronisation</h3><p>Manuell über Dashboard oder Statusbar.</p><h3>MCP</h3><p>Inaktiv. Die Einrichtung ist nicht Teil dieses Vertikalschnitts.</p></div>}
      </section>
    </main>
  </div>;
}

function Brand(): React.JSX.Element { return <div className="brand"><span>UC</span><strong>UniCloudConnect</strong></div>; }
function FeatureGrid({ items }: { items: string[] }): React.JSX.Element { return <div className="feature-grid">{items.map((item) => <div key={item}>{item}</div>)}</div>; }
function OptionCard({ title, text, selected, disabled }: { title: string; text: string; selected?: boolean; disabled?: boolean }): React.JSX.Element { return <div className={`option-card${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}><span className="radio" /><div><strong>{title}</strong><p>{text}</p></div></div>; }
function CourseList({ courses, toggleCourse }: { courses: Course[]; toggleCourse(course: Course): Promise<void> }): React.JSX.Element { return <div className="course-list">{courses.length ? courses.map((course) => <button type="button" key={course.courseId} onClick={() => void toggleCourse(course)}><span className={course.isSelected ? 'check checked' : 'check'}>{course.isSelected ? '✓' : ''}</span><div><strong>{course.fullname}</strong><small>{course.semester ?? course.shortname ?? `Kurs ${course.courseId}`}</small></div></button>) : <div className="empty-inline">Noch keine Kurse geladen.</div>}</div>; }
function Metric({ label, value, suffix }: { label: string; value: string; suffix?: string }): React.JSX.Element { return <div className="metric"><small>{label}</small><strong>{value}</strong>{suffix && <span>{suffix}</span>}</div>; }
function EmptyState({ title, text }: { title: string; text: string }): React.JSX.Element { return <div className="empty-state"><div>UC</div><h3>{title}</h3><p>{text}</p></div>; }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unbekannter Fehler.'; }
function statusLabel(status: SyncStatus['state']): string { return ({ idle: 'Bereit', syncing: 'Synchronisiert', error: 'Fehler', needs_setup: 'Einrichtung nötig' })[status]; }
function dashboardTitle(tab: DashboardTab): string { return ({ overview: 'Übersicht', courses: 'Kurse & Auswahl', transcripts: 'Transkriptionen', library: 'Lokale Bibliothek', settings: 'Einstellungen' })[tab]; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function formatBytes(value: number | null): string { if (value === null) return 'Größe unbekannt'; if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }
