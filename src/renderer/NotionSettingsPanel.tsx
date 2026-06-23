import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { NotionConfigState, NotionDatabaseSummary } from '../shared/domain';

/** Wie in App.tsx: einheitliche Fehlertext-Extraktion für catch-Blöcke. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler.';
}

const EMPTY_CONFIG: NotionConfigState = {
  connected: false,
  workspaceName: null,
  selectedDbId: null,
  adapterMode: 'filesystem',
};

/**
 * Settings-Sektion „Notion-Anbindung" (Issue #27, Part 4).
 *
 * Drei Teile in einer Komponente, weil sie denselben Verbindungsstatus teilen:
 * 1) Token-Setup (Passwortfeld + Verify, Token wird nie im State gehalten),
 * 2) Datenbank-Picker (inkrementelle Suche, portiert aus notion-drive-sync),
 * 3) Ausgabe-Modus-Schalter (filesystem ↔ notion/both).
 */
export function NotionSettingsPanel(): React.JSX.Element {
  const [config, setConfig] = useState<NotionConfigState>(EMPTY_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Token-Setup: Eingabe lebt nur lokal und wird nach Verify sofort gelöscht.
  const [tokenInput, setTokenInput] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [tokenOk, setTokenOk] = useState<boolean | null>(null);

  // Datenbank-Picker.
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMessage, setDbMessage] = useState<string | null>(null);

  // Ausgabe-Modus.
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMessage, setModeMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.api.getNotionConfig().then((state) => {
      if (!active) return;
      setConfig(state);
      setLoadingConfig(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setTokenMessage(errorMessage(error));
      setLoadingConfig(false);
    });
    return () => { active = false; };
  }, []);

  async function handleVerifyToken(): Promise<void> {
    if (!tokenInput) return;
    setTokenBusy(true);
    setTokenMessage(null);
    try {
      const result = await window.api.verifyNotionToken({ token: tokenInput });
      // Token sofort aus dem State löschen — unabhängig vom Ergebnis, niemals behalten.
      setTokenInput('');
      if (result.ok) {
        setTokenOk(true);
        setConfig((current) => ({ ...current, connected: true, workspaceName: result.workspaceName ?? current.workspaceName }));
        const refreshed = await window.api.getNotionConfig();
        setConfig(refreshed);
      } else {
        setTokenOk(false);
        setTokenMessage(result.message ?? 'Token konnte nicht verifiziert werden.');
      }
    } catch (error) {
      setTokenInput('');
      setTokenOk(false);
      setTokenMessage(errorMessage(error));
    } finally {
      setTokenBusy(false);
    }
  }

  async function handleSelectDatabase(db: NotionDatabaseSummary): Promise<void> {
    setDbBusy(true);
    setDbMessage(null);
    try {
      await window.api.setNotionDatabase({ databaseId: db.id });
      setSelectedTitle(db.title);
      setConfig((current) => ({ ...current, selectedDbId: db.id }));
    } catch (error) {
      setDbMessage(errorMessage(error));
    } finally {
      setDbBusy(false);
    }
  }

  async function handleToggleOutputMode(enabled: boolean): Promise<void> {
    setModeBusy(true);
    setModeMessage(null);
    const mode = enabled ? 'both' : 'filesystem';
    try {
      await window.api.setNotionOutputMode({ mode });
      setConfig((current) => ({ ...current, adapterMode: mode }));
    } catch (error) {
      setModeMessage(errorMessage(error));
    } finally {
      setModeBusy(false);
    }
  }

  const outputEnabled = config.adapterMode === 'notion' || config.adapterMode === 'both';

  return <>
    <div className="panel">
      <div className="split-heading">
        <div>
          <strong>Verbindung</strong>
          <p className="muted">
            {loadingConfig
              ? 'Lädt …'
              : config.connected
                ? <>Verbunden{config.workspaceName ? ` mit „${config.workspaceName}"` : ''}.</>
                : 'Noch kein Notion-Token hinterlegt.'}
          </p>
        </div>
        <span className={config.connected ? 'badge success' : 'badge'}>
          {config.connected ? 'Verbunden' : 'Nicht verbunden'}
        </span>
      </div>

      <label>Integrations-Token
        <input
          type="password"
          autoComplete="off"
          value={tokenInput}
          disabled={tokenBusy}
          placeholder="secret_…"
          onChange={(event) => { setTokenInput(event.target.value); setTokenOk(null); }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !tokenBusy && tokenInput) void handleVerifyToken(); }}
        />
      </label>
      <button className="button secondary" type="button" disabled={tokenBusy || !tokenInput} onClick={() => void handleVerifyToken()}>
        {tokenBusy ? 'Prüft …' : 'Überprüfen'}
      </button>
      {tokenMessage && <div className={tokenOk === false ? 'notice error' : 'notice'}>{tokenMessage}</div>}
    </div>

    <div className="panel">
      <strong>Ziel-Datenbank</strong>
      <p className="muted">Datenbank, in die LearnWeb-Inhalte zusätzlich nach Notion gepusht werden.</p>
      <NotionDatabasePicker
        disabled={!config.connected || dbBusy}
        selectedTitle={selectedTitle}
        selectedId={config.selectedDbId ?? null}
        onSelect={(db) => void handleSelectDatabase(db)}
      />
      {dbMessage && <div className="notice error">{dbMessage}</div>}
    </div>

    <div className="panel">
      <label className="option-card" style={{ cursor: modeBusy ? 'default' : 'pointer' }}>
        <input
          type="checkbox"
          checked={outputEnabled}
          disabled={modeBusy}
          onChange={(event) => void handleToggleOutputMode(event.target.checked)}
        />
        <span>
          <strong>Notion-Ausgabe aktivieren</strong>
          <p>Zusätzlich zur lokalen Ablage auch nach Notion synchronisieren.</p>
        </span>
      </label>
      {modeMessage && <div className="notice error">{modeMessage}</div>}
    </div>
  </>;
}

/**
 * Inkrementelle Suche über window.api.searchNotionDatabases.
 * Portiert aus ARCHIV/notion-drive-sync/src/components/NotionDataSourcePicker.tsx:
 * 250ms Debounce, Suche erst ab Querylänge ≥ 2, Stale-Request-Killer via
 * Sequenznummer (useRef), Tastatur-Navigation (↑/↓/Enter/Esc).
 */
function NotionDatabasePicker(props: {
  disabled: boolean;
  selectedTitle: string | null;
  selectedId: string | null;
  onSelect(db: NotionDatabaseSummary): void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<NotionDatabaseSummary[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const requestSeq = useRef(0);

  // Debounce: Suchtext erst 250ms nach letzter Eingabe übernehmen.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Suche erst ab 2 Zeichen; veraltete Responses werden per Sequenznummer verworfen.
  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      setHighlight(0);
      return;
    }
    const requestId = ++requestSeq.current;
    setLoading(true);
    window.api.searchNotionDatabases({ query: debounced })
      .then((found) => {
        if (requestId !== requestSeq.current) return; // stale, verwerfen
        setResults(found);
        setHighlight(0);
      })
      .catch(() => {
        if (requestId !== requestSeq.current) return;
        setResults([]);
      })
      .finally(() => {
        if (requestId === requestSeq.current) setLoading(false);
      });
  }, [debounced]);

  function pick(db: NotionDatabaseSummary): void {
    props.onSelect(db);
    setOpen(false);
    setQuery('');
    setDebounced('');
    setResults([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const candidate = results[highlight];
      if (candidate) pick(candidate);
    }
  }

  return (
    <div className="notion-db-picker">
      <input
        type="text"
        value={query}
        disabled={props.disabled}
        placeholder={props.selectedTitle ?? (props.selectedId ? props.selectedId : 'Datenbank suchen …')}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="notion-db-results">
          {loading && <div className="notion-db-empty">Sucht …</div>}
          {!loading && debounced.length >= 2 && results.length === 0 && (
            <div className="notion-db-empty">Keine Treffer.</div>
          )}
          {!loading && debounced.length < 2 && (
            <div className="notion-db-empty">Mindestens 2 Zeichen eingeben.</div>
          )}
          {results.map((db, index) => (
            <button
              key={db.id}
              type="button"
              className={index === highlight ? 'notion-db-option active' : 'notion-db-option'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(db)}
            >
              <span className="notion-db-icon">{db.icon ?? '🗂️'}</span>
              <span className="notion-db-title">{db.title}</span>
              {db.id === props.selectedId && <span className="badge success">gewählt</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
