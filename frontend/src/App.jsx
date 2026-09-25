import { useState } from "react";
import {
  ArrowUp,
  ExternalLink,
  Globe,
  LoaderCircle,
  Search,
  Sparkles,
} from "lucide-react";
import "./App.css";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

function App() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

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

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "The search request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          let eventName = "message";
          let dataText = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            }

            if (line.startsWith("data: ")) {
              dataText += line.slice(6);
            }
          }

          if (!dataText) {
            continue;
          }

          try {
            const data = JSON.parse(dataText);

            if (eventName === "sources") {
              setSources(Array.isArray(data) ? data : []);
            }

            if (eventName === "token" && typeof data === "string") {
              setAnswer((current) => current + data);
            }

            if (eventName === "followups") {
              setFollowups(Array.isArray(data) ? data : []);
            }

            if (eventName === "error") {
              setError(data?.message || "The search failed.");
            }
          } catch {
            // Ignore malformed SSE blocks and continue reading the stream.
          }
        }
      }
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

        <div className="status">
          <span className="status-dot" />
          AI Search
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
                  <div className="answer-text">{answer}</div>
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
