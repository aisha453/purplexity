import { useEffect, useState } from "react";
import {
  ArrowUp,
  ExternalLink,
  Globe,
  LoaderCircle,
  Search,
  Sparkles,
  Moon,
  Sun,
} from "lucide-react";
import "./App.css";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

function renderInline(text, key) {
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const partKey = `${key}-${match.index}`;
    if (match[2]) parts.push(<a key={partKey} href={match[3]} target="_blank" rel="noreferrer">{match[2]}</a>);
    else if (match[4]) parts.push(<code key={partKey}>{match[4]}</code>);
    else if (match[5]) parts.push(<strong key={partKey}>{match[5]}</strong>);
    else parts.push(<em key={partKey}>{match[6]}</em>);
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function FormattedAnswer({ content }) {
  const lines = content.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}`;
      blocks.push(<Tag key={index}>{renderInline(heading[2], index)}</Tag>);
      index += 1;
    } else if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(isOrdered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={index}>{renderInline(item[1], index)}</li>);
        index += 1;
      }
      const Tag = isOrdered ? "ol" : "ul";
      blocks.push(<Tag key={`list-${index}`}>{items}</Tag>);
    } else {
      const paragraph = [];
      while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^[-*]\s+|^\d+\.\s+/.test(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push(<p key={index}>{renderInline(paragraph.join(" "), index)}</p>);
    }
  }
  return <div className="answer-text">{blocks}</div>;
}

function App() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  async function search(searchQuery = query) {
    const trimmedQuery = searchQuery.trim();

    if (!trimmedQuery || loading) {
      return;
    }

    setQuery(trimmedQuery);
    setAnswer("");
    setSources([]);
    setFollowups([]);
    setError("");
    setSearched(true);
    setLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/conversation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: trimmedQuery }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "The search request failed.");
      }

      setSources(Array.isArray(data?.sources) ? data.sources : []);
      setAnswer(typeof data?.answer === "string" ? data.answer : "");
      setFollowups(Array.isArray(data?.followups) ? data.followups : []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not connect to the Purplexity backend."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    search();
  }

  return (
    <div className="app">
      <header className="navbar">
        <button className="brand" onClick={() => window.location.reload()}>
          <span className="brand-mark">
            <Sparkles size={16} strokeWidth={2.3} />
          </span>
          <span>Purplexity</span>
        </button>

        <div className="nav-actions">
          <div className="status">
          <span className="status-dot" />
          AI Search
          </div>
          <button className="theme-toggle" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main>
        <section className={`hero ${searched ? "hero-results" : ""}`}>
          {!searched && (
            <>
              <div className="hero-mark">
                <Sparkles size={24} strokeWidth={2.1} />
              </div>
              <p className="eyebrow">AI-powered web search</p>
              <h1>What do you want to know?</h1>
              <p className="subtitle">
                Search the web. Understand the answer. Keep exploring.
              </p>
            </>
          )}

          <form className="search-form" onSubmit={handleSubmit}>
            <Search className="search-icon" size={20} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask anything..."
              aria-label="Search query"
              autoFocus={!searched}
            />
            <button
              className="search-button"
              type="submit"
              disabled={!query.trim() || loading}
              aria-label="Search"
            >
              {loading ? (
                <LoaderCircle className="spin" size={19} />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </form>
        </section>

        {searched && (
          <section className="results">
            {sources.length > 0 && (
              <div className="result-block">
                <div className="section-heading">
                  <Globe size={16} />
                  <span>Sources</span>
                  <span className="source-count">{sources.length}</span>
                </div>

                <div className="source-list">
                  {sources.map((source) => (
                    <a
                      className="source-card"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      key={source.id}
                    >
                      <span className="source-index">{source.id}</span>
                      <span className="source-name">
                        {source.title || source.url}
                      </span>
                      <ExternalLink size={15} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <article className="result-block answer-block">
              <div className="section-heading">
                <Sparkles size={16} />
                <span>Answer</span>
              </div>

              <div className="answer-card">
                {answer ? (
                  <FormattedAnswer content={answer} />
                ) : loading ? (
                  <div className="answer-loading">
                    <LoaderCircle className="spin" size={18} />
                    <span>Searching the web and thinking...</span>
                  </div>
                ) : null}
              </div>
            </article>

            {followups.length > 0 && (
              <div className="result-block followup-block">
                <div className="section-heading">
                  <span>Continue exploring</span>
                </div>

                <div className="followup-list">
                  {followups.map((followup, index) => (
                    <button
                      className="followup"
                      key={`${followup}-${index}`}
                      onClick={() => search(followup)}
                    >
                      <span>{followup}</span>
                      <ArrowUp size={16} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="error">{error}</div>}
          </section>
        )}
      </main>

      <footer>Purplexity searches the web to help you research faster.</footer>
    </div>
  );
}

export default App;
