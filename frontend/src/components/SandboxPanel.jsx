import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";
const ACTIONS = ["send_email", "github_push", "read_email", "read_calendar", "calendar_write", "github_delete"];

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px" },
  panel: { width: "min(1120px, 96vw)", maxHeight: "90vh", background: "#0d1117", border: "1px solid #1e3a5f", borderRadius: "4px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden", fontFamily: "'Courier New', monospace" },
  label: { fontSize: "10px", color: "#4a90a4", letterSpacing: "3px", textTransform: "uppercase" },
  select: { background: "#0a0a0f", border: "1px solid #1e3a5f", color: "#a0b4c8", padding: "8px", fontSize: "12px", width: "100%", letterSpacing: "1px", outline: "none", fontFamily: "'Courier New', monospace" },
  input: { background: "#0a0a0f", border: "1px solid #1e3a5f", color: "#a0b4c8", padding: "8px", fontSize: "12px", width: "100%", letterSpacing: "1px", outline: "none", fontFamily: "'Courier New', monospace", boxSizing: "border-box" },
  textarea: { background: "#0a0a0f", border: "1px solid #1e3a5f", color: "#a0b4c8", padding: "8px", fontSize: "12px", width: "100%", letterSpacing: "1px", outline: "none", fontFamily: "'Courier New', monospace", boxSizing: "border-box", minHeight: "88px", resize: "vertical" },
  btn: { background: "transparent", border: "1px solid #4a90a4", color: "#4a90a4", padding: "8px 12px", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Courier New', monospace" },
  closeBtn: { background: "transparent", border: "1px solid #4a6080", color: "#4a6080", padding: "6px 10px", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Courier New', monospace" },
  badge: { display: "inline-block", border: "1px solid #ffaa00", color: "#ffaa00", padding: "2px 6px", fontSize: "9px", letterSpacing: "2px" },
  tab: (active) => ({
    background: active ? "#0d1a2a" : "transparent",
    border: `1px solid ${active ? "#1e3a5f" : "#1e3a5f"}`,
    color: active ? "#a0b4c8" : "#4a90a4",
    padding: "6px 10px",
    fontSize: "10px",
    letterSpacing: "2px",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "'Courier New', monospace",
  }),
  card: (active) => ({
    background: active ? "#0d1a2a" : "#0a0a0f",
    border: `1px solid ${active ? "#1e3a5f" : "#111"}`,
    borderRadius: "2px",
    padding: "10px",
    fontSize: "11px",
    cursor: "pointer",
    opacity: active ? 1 : 0.75,
  }),
  resultBox: (status) => {
    const color =
      status === "stepup" ? "#ffaa00" :
      status === "blocked" ? "#ff4444" :
      "#00ff88";
    const bg =
      status === "stepup" ? "#1a1400" :
      status === "blocked" ? "#1a0a0a" :
      "#0a1a0f";
    return { border: `1px solid ${color}`, borderRadius: "2px", padding: "12px", background: bg };
  },
  bigBadge: (status) => {
    const color =
      status === "stepup" ? "#ffaa00" :
      status === "blocked" ? "#ff4444" :
      "#00ff88";
    return { display: "inline-block", border: `1px solid ${color}`, color, padding: "4px 10px", fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase" };
  },
};

function SandboxPanel({ onClose }) {
  const [mode, setMode] = useState("test"); // "test" | "forge"

  const [policies, setPolicies] = useState([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState(null);

  const selectedRule = useMemo(
    () => policies.find((p) => p.id === selectedRuleId) || null,
    [policies, selectedRuleId]
  );

  const [action, setAction] = useState("send_email");
  const [params, setParams] = useState({
    to: "",
    subject: "",
    body: "",
    repo: "",
    branch: "",
    message: "",
    folder: "inbox",
    json: "{}",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [forgeText, setForgeText] = useState("");
  const [forgedRule, setForgedRule] = useState(null);
  const [forgeResult, setForgeResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const suggestParamsForRule = (rule) => {
    const cond = String(rule?.condition || "").trim();
    const cl = cond.toLowerCase();
    const out = {};

    // Generic / action-specific heuristics to force a match
    if (rule?.action === "github_push") {
      if (cl.includes("main")) {
        out.branch = "main";
      } else {
        out.branch = "feature/test";
      }
      out.repo = "demo/repo";
      out.message = "test push";
    }

    if (rule?.action === "github_delete") {
      out.repo = "demo/repo";
      out.branch = "old-branch";
    }

    if (rule?.action === "send_email") {
      if (cl.includes("company.com") || cl.includes("domain")) {
        out.to = "test@company.com";
      } else if (cl.includes("unknown") || cl.includes("recipient")) {
        out.to = "unknown@gmail.com";
      } else {
        out.to = "unknown@external.com";
      }
      out.subject = "test";
      out.body = "test";
    }

    if (rule?.action === "read_email") {
      if (cl.includes("count") || cl.includes("100")) {
        out.folder = "inbox";
        out.maxResults = 1000;
      } else {
        out.folder = "inbox";
        out.maxResults = 5;
      }
    }

    // attendees > N
    if (cl.includes("attendees") && cl.includes(">")) {
      const rhs = cond.split(">", 2)[1] || "";
      const n = parseInt(rhs.trim(), 10);
      if (!Number.isNaN(n)) out.attendees = n + 1;
    }

    // ANY means any payload should match; just ensure non-empty basics
    if (cl === "any") {
      if (rule?.action === "send_email") out.to = out.to || "unknown@external.com";
      if (rule?.action === "github_push") out.branch = out.branch || "main";
    }

    return out;
  };

  useEffect(() => {
    let mounted = true;
    const fetchPolicies = async () => {
      setPoliciesLoading(true);
      try {
        const res = await axios.get(`${API}/policies`, { withCredentials: true });
        const active = (res.data || []).filter((p) => p && p.active);
        if (!mounted) return;
        setPolicies(active);
        if (active.length && selectedRuleId == null) setSelectedRuleId(active[0].id);
      } catch (e) {
        // silent; user can still use forge+test mode
      } finally {
        if (mounted) setPoliciesLoading(false);
      }
    };
    fetchPolicies();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fields = useMemo(() => {
    if (action === "send_email") return ["to", "subject", "body"];
    if (action === "github_push") return ["repo", "branch", "message"];
    if (action === "read_email") return ["folder"];
    return ["json"];
  }, [action]);

  const buildParams = () => {
    if (action === "send_email") return { to: params.to, subject: params.subject, body: params.body };
    if (action === "github_push") return { repo: params.repo, branch: params.branch, message: params.message };
    if (action === "read_email") return { folder: params.folder };
    try {
      const parsed = JSON.parse(params.json || "{}");
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      throw new Error("Params JSON is invalid.");
    }
  };

  const simulate = async (overrideRule = null) => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const built = buildParams();
      const res = await axios.post(
        `${API}/sandbox/simulate`,
        { action, params: built, rule_override: overrideRule || undefined },
        { headers: { "Content-Type": "application/json" }, withCredentials: true }
      );
      setResult(res.data);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setError((typeof detail === "string" && detail) || e?.message || "Simulation failed.");
    } finally {
      setLoading(false);
    }
  };

  const renderDecision = (payload, fallbackAction) => {
    const d = payload?.decision || null;
    const allowed = d?.allowed ?? payload?.allowed;
    const stepUp = !!(d?.step_up_required || payload?.step_up_required);
    const status = stepUp ? "stepup" : allowed ? "allowed" : "blocked";
    const rule = d?.rule || null;

    return (
      <div style={s.resultBox(status)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#a0b4c8", letterSpacing: "1px" }}>{fallbackAction}</span>
          <span style={s.bigBadge(status)}>
            {status === "stepup" ? "STEP-UP REQUIRED" : status === "blocked" ? "BLOCKED" : "ALLOWED"}
          </span>
        </div>

        {status === "allowed" && (
          <div style={{ marginTop: "10px", fontSize: "10px", color: "#4a6080" }}>
            <div>{d?.message || "No matching rule — action permitted"}</div>
            <div style={{ marginTop: "6px" }}>Simulated success. No external API calls were made.</div>
          </div>
        )}

        {status !== "allowed" && (
          <div style={{ marginTop: "10px", fontSize: "10px", color: "#4a6080" }}>
            <div>{d?.message || "Agent action was intercepted by AgentGate"}</div>
            {rule?.id != null && <div style={{ marginTop: "6px" }}>{`Rule: #${rule.id}`}</div>}
            {rule?.condition && <div style={{ marginTop: "6px" }}>{`Condition: ${rule.condition}`}</div>}
            {rule?.effect && <div style={{ marginTop: "6px" }}>{`Effect: ${rule.effect}`}</div>}
            <div style={{ marginTop: "6px" }}>{`Reason: ${rule?.reason || payload?.reason || "Blocked by policy."}`}</div>
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (mode !== "test") return;
    if (!selectedRule?.action) return;
    setAction(selectedRule.action);
    setResult(null);
    setError("");
    // Auto-fill values that should trigger the selected rule
    const suggested = suggestParamsForRule(selectedRule);
    setParams((p) => ({ ...p, ...suggested }));
  }, [mode, selectedRule]);

  const forgeAndTest = async () => {
    const text = forgeText.trim();
    if (!text) return;

    setError("");
    setForgeResult(null);
    setResult(null);
    setSaveMsg("");
    setLoading(true);

    try {
      const forgeRes = await axios.post(
        `${API}/ai/forge-rule`,
        { text },
        { headers: { "Content-Type": "application/json" }, withCredentials: true }
      );
      const rule = forgeRes?.data;
      if (!rule?.action || !rule?.condition || !rule?.effect || !rule?.reason) {
        throw new Error("AI rule missing required fields.");
      }
      setForgedRule(rule);

      // Build a sample action payload to test immediately
      const sampleByAction = {
        send_email: { to: "unknown@example.com", subject: "test", body: "execution lab" },
        github_push: { repo: "demo/repo", branch: "main", message: "execution lab" },
        read_email: { folder: "inbox" },
        read_calendar: { scope: "today" },
        calendar_write: { attendees: 12, title: "execution lab" },
        github_delete: { repo: "demo/repo", branch: "main" },
      };
      const sampleParams = sampleByAction[rule.action] || {};

      const simRes = await axios.post(
        `${API}/sandbox/simulate`,
        { action: rule.action, params: sampleParams, temp_rule: { condition: rule.condition, effect: rule.effect } },
        { headers: { "Content-Type": "application/json" }, withCredentials: true }
      );
      setForgeResult({ rule, sample: { action: rule.action, params: sampleParams }, result: simRes.data });
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setError((typeof detail === "string" && detail) || e?.message || "Forge & test failed.");
    } finally {
      setLoading(false);
    }
  };

  const saveForgedRule = async () => {
    if (!forgedRule) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await axios.post(`${API}/policies`, forgedRule, { headers: { "Content-Type": "application/json" }, withCredentials: true });
      setSaveMsg("Saved.");
      // refresh policies list so it appears in Mode 1
      try {
        const res = await axios.get(`${API}/policies`, { withCredentials: true });
        const active = (res.data || []).filter((p) => p && p.active);
        setPolicies(active);
      } catch {
        // ignore
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setSaveMsg((typeof detail === "string" && detail) || e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={s.panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={s.label}>Execution Lab</div>
            <span style={s.badge}>EX-LAB</span>
          </div>
          <button style={s.closeBtn} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button style={s.tab(mode === "test")} onClick={() => setMode("test")}>TEST EXISTING RULES</button>
          <button style={s.tab(mode === "forge")} onClick={() => setMode("forge")}>FORGE + TEST</button>
        </div>

        {mode === "test" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "12px", overflow: "hidden", flex: 1, minHeight: 0 }}>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", minHeight: 0, border: "1px solid #1e3a5f", borderRadius: "2px", padding: "10px", background: "#0a0a0f" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#4a90a4", letterSpacing: "3px", textTransform: "uppercase" }}>Active Rules</div>
                <div style={{ fontSize: "9px", color: "#4a6080" }}>{policiesLoading ? "loading..." : `${policies.length}`}</div>
              </div>
              {policies.length === 0 && !policiesLoading && (
                <div style={{ color: "#2a4a5a", fontSize: "11px", letterSpacing: "1px", marginTop: "12px", textAlign: "center" }}>
                  no active rules
                </div>
              )}
              {policies.map((p) => (
                <div
                  key={p.id}
                  style={s.card(p.id === selectedRuleId)}
                  onClick={() => setSelectedRuleId(p.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                    <span style={{ color: "#a0b4c8", letterSpacing: "1px" }}>{p.action}</span>
                    <span style={{ color: "#4a90a4", fontSize: "10px" }}>{`#${p.id}`}</span>
                  </div>
                  <div style={{ color: "#6a8a9a", fontSize: "10px", marginTop: "4px" }}>{p.condition}</div>
                  <div style={{ color: "#4a6080", fontSize: "10px", marginTop: "4px" }}>{p.reason}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "10px", color: "#4a90a4", letterSpacing: "3px", textTransform: "uppercase" }}>Test Input</div>

              <select style={s.select} value={action} onChange={(e) => setAction(e.target.value)}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>

              {fields.includes("to") && <input style={s.input} placeholder="to" value={params.to} onChange={(e) => setParams((p) => ({ ...p, to: e.target.value }))} />}
              {fields.includes("subject") && <input style={s.input} placeholder="subject" value={params.subject} onChange={(e) => setParams((p) => ({ ...p, subject: e.target.value }))} />}
              {fields.includes("body") && <textarea style={s.textarea} placeholder="body" value={params.body} onChange={(e) => setParams((p) => ({ ...p, body: e.target.value }))} />}

              {fields.includes("repo") && <input style={s.input} placeholder="repo" value={params.repo} onChange={(e) => setParams((p) => ({ ...p, repo: e.target.value }))} />}
              {fields.includes("branch") && <input style={s.input} placeholder="branch" value={params.branch} onChange={(e) => setParams((p) => ({ ...p, branch: e.target.value }))} />}
              {fields.includes("message") && <textarea style={s.textarea} placeholder="message" value={params.message} onChange={(e) => setParams((p) => ({ ...p, message: e.target.value }))} />}

              {fields.includes("folder") && <input style={s.input} placeholder="folder (e.g. inbox)" value={params.folder} onChange={(e) => setParams((p) => ({ ...p, folder: e.target.value }))} />}

              {fields.includes("json") && (
                <textarea
                  style={s.textarea}
                  placeholder='params as JSON (e.g. { "branch": "main" })'
                  value={params.json}
                  onChange={(e) => setParams((p) => ({ ...p, json: e.target.value }))}
                />
              )}

              <button style={{ ...s.btn, width: "100%" }} onClick={() => simulate(null)} disabled={loading}>
                {loading ? "SIMULATING..." : "SIMULATE"}
              </button>

              {error && <div style={{ fontSize: "10px", color: "#ff4444" }}>{error}</div>}

              {result && (
                (typeof result.allowed === 'boolean' && typeof action === 'string') ?
                  renderDecision(result, action) :
                  <div style={{ fontSize: "10px", color: "#ff4444" }}>Unexpected response from server</div>
              )}
            </div>
          </div>
        )}

        {mode === "forge" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <textarea
              style={s.textarea}
              placeholder={"Describe a rule in plain English...\n(e.g. don't let agent email unknown contacts)"}
              value={forgeText}
              onChange={(e) => setForgeText(e.target.value)}
            />

            <button style={{ ...s.btn, width: "100%" }} onClick={forgeAndTest} disabled={loading}>
              {loading ? "FORGING..." : "FORGE & TEST"}
            </button>

            {error && <div style={{ fontSize: "10px", color: "#ff4444" }}>{error}</div>}

            {forgeResult?.rule && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div style={{ border: "1px solid #1e3a5f", borderRadius: "2px", padding: "10px", background: "#0a0a0f" }}>
                  <div style={{ fontSize: "10px", color: "#4a90a4", letterSpacing: "3px", textTransform: "uppercase" }}>Generated Rule</div>
                  <div style={{ marginTop: "8px", fontSize: "11px", color: "#a0b4c8" }}>{forgeResult.rule.action}</div>
                  <div style={{ marginTop: "6px", fontSize: "10px", color: "#6a8a9a" }}>{forgeResult.rule.condition}</div>
                  <div style={{ marginTop: "6px", fontSize: "10px", color: "#4a6080" }}>{forgeResult.rule.reason}</div>
                  <div style={{ marginTop: "6px", fontSize: "10px", color: "#4a6080" }}>{`Effect: ${forgeResult.rule.effect}`}</div>
                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
                    <button style={s.btn} onClick={saveForgedRule} disabled={saving}>
                      {saving ? "SAVING..." : "SAVE RULE"}
                    </button>
                    {saveMsg && <span style={{ fontSize: "10px", color: saveMsg === "Saved." ? "#00ff88" : "#ff4444" }}>{saveMsg}</span>}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "10px", color: "#4a90a4", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "8px" }}>Test Result</div>
                  {(forgeResult?.result && typeof forgeResult.result.allowed === 'boolean' && typeof (forgeResult.sample?.action || forgeResult.rule.action) === 'string') ?
                    renderDecision(forgeResult?.result, forgeResult.sample?.action || forgeResult.rule.action) :
                    <div style={{ fontSize: "10px", color: "#ff4444" }}>Unexpected response from server</div>
                  }
                  <div style={{ marginTop: "8px", fontSize: "10px", color: "#2a4a5a" }}>
                    sample params: {JSON.stringify(forgeResult.sample?.params || {})}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SandboxPanel;

