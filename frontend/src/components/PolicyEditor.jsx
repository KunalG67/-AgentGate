import { useEffect, useState } from "react";
import axios from "axios";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";
const ACTIONS = ["send_email", "read_email", "github_push", "github_delete", "calendar_write", "read_calendar"];
const EFFECTS = ["BLOCK", "BLOCK+STEPUP"];

const s = {
  panel: { background: "#0d1117", border: "1px solid #1e3a5f", borderRadius: "4px", padding: "16px", height: "100%", display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden" },
  label: { fontSize: "10px", color: "#00ffff", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "12px", borderLeft: "2px solid #ff00ff", paddingLeft: "10px" },
  select: { background: "#0a0a0f", border: "1px solid #1e3a5f", color: "#a0b4c8", padding: "8px", fontSize: "12px", width: "100%", letterSpacing: "1px", outline: "none", fontFamily: "'Courier New', monospace" },
  input: { background: "#0a0a0f", border: "1px solid #1e3a5f", color: "#a0b4c8", padding: "8px", fontSize: "12px", width: "100%", letterSpacing: "1px", outline: "none", fontFamily: "'Courier New', monospace", boxSizing: "border-box" },
  textarea: { background: "#0a0a0f", border: "1px solid #1e3a5f", color: "#a0b4c8", padding: "8px", fontSize: "12px", width: "100%", letterSpacing: "1px", outline: "none", fontFamily: "'Courier New', monospace", boxSizing: "border-box", minHeight: "64px", resize: "vertical" },
  btn: { background: "transparent", border: "1px solid #00ffff", color: "#00ffff", padding: "8px", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", width: "100%", fontFamily: "'Courier New', monospace" },
  btnMagenta: { background: "rgba(255, 0, 255, 0.06)", border: "1px solid #ff00ff", color: "#ff00ff", padding: "8px", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", cursor: "pointer", width: "100%", fontFamily: "'Courier New', monospace", transition: "all 0.2s" },
  ruleCard: (active) => ({ background: active ? "#0d1a2a" : "#0a0a0f", border: `1px solid ${active ? "#1e3a5f" : "#111"}`, borderRadius: "2px", padding: "10px", fontSize: "11px", opacity: active ? 1 : 0.4 }),
  tag: (color) => ({ display: "inline-block", background: "transparent", border: `1px solid ${color}`, color: color, padding: "2px 6px", fontSize: "9px", letterSpacing: "2px", marginRight: "4px" }),
  smallBtn: (color) => ({ background: "transparent", border: `1px solid ${color}`, color: color, padding: "3px 8px", fontSize: "9px", letterSpacing: "1px", cursor: "pointer", fontFamily: "'Courier New', monospace" }),
};

export default function PolicyEditor() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [addError, setAddError] = useState("");
  const [actionError, setActionError] = useState("");
  const [togglingId, setTogglingId] = useState(null);
  const [form, setForm] = useState({ action: "send_email", condition: "", effect: "BLOCK", reason: "" });
  const [aiText, setAiText] = useState("");
  const [isForging, setIsForging] = useState(false);
  const [forgeError, setForgeError] = useState("");

  const fetchPolicies = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await axios.get(`${API}/policies`, { withCredentials: true });
      setPolicies(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setFetchError(
        (typeof detail === "string" && detail) ||
        e?.message ||
        "Failed to load policies."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPolicies(); }, []);

  const addPolicy = async () => {
    if (!form.condition || !form.reason) return;
    setAddError("");
    try {
      await axios.post(`${API}/policies`, form, { withCredentials: true });
      setAiText("");
      setForgeError("");
      setForm({ action: "send_email", condition: "", effect: "BLOCK", reason: "" });
      fetchPolicies();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setAddError(
        (typeof detail === "string" && detail) ||
        e?.message ||
        "Failed to add rule."
      );
    }
  };

  const deletePolicy = async (id) => {
    setActionError("");
    try {
      await axios.delete(`${API}/policies/${id}`, { withCredentials: true });
      fetchPolicies();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setActionError(
        (typeof detail === "string" && detail) ||
        e?.message ||
        "Failed to delete rule."
      );
    }
  };

  const togglePolicy = async (id) => {
    if (togglingId) return;
    setTogglingId(id);
    setActionError("");
    try {
      await axios.patch(`${API}/policies/${id}/toggle`, null, { withCredentials: true });
      fetchPolicies();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setActionError(
        (typeof detail === "string" && detail) ||
        e?.message ||
        "Failed to toggle rule."
      );
    } finally {
      setTogglingId(null);
    }
  };

  const forgeRule = async () => {
    const text = aiText.trim();
    if (!text) return;
    setIsForging(true);
    setForgeError("");
    try {
      const res = await axios.post(
        `${API}/ai/forge-rule`,
        { text },
        { headers: { "Content-Type": "application/json" }, withCredentials: true }
      );
      const parsed = res?.data;
      const next = {
        action: parsed?.action,
        condition: parsed?.condition,
        effect: parsed?.effect,
        reason: parsed?.reason,
      };
      if (!next.action || !next.condition || !next.effect || !next.reason) {
        throw new Error("AI response missing required fields.");
      }
      setForm(next);
      setForgeError("");
    } catch (e) {
      const serverDetail = e?.response?.data?.detail;
      setForgeError(
        (typeof serverDetail === "string" && serverDetail) ||
        e?.message ||
        "Failed to forge rule."
      );
    } finally {
      setIsForging(false);
    }
  };

  return (
    <div style={s.panel}>
      <div style={s.label}>Policy Rules</div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
          <textarea
            style={s.textarea}
            placeholder={"Describe your rule in plain English...\ne.g. don't let agent email unknown contacts"}
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
          />
          <button 
            style={{ ...s.btnMagenta, width: "160px" }} 
            onClick={forgeRule} 
            disabled={isForging}
            onMouseEnter={(e) => {
              e.target.style.background = "rgba(255, 0, 255, 0.15)";
              e.target.style.boxShadow = "0 0 14px rgba(255, 0, 255, 0.35)";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "rgba(255, 0, 255, 0.06)";
              e.target.style.boxShadow = "none";
            }}
          >
            {isForging ? "Forging..." : "Forge Rule"}
          </button>
        </div>
        {isForging && <div style={{ fontSize: "10px", color: "#4a6080" }}>Forging rule...</div>}
        {!!forgeError && <div style={{ fontSize: "10px", color: "#ff4444" }}>{forgeError}</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <select style={s.select} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
          {ACTIONS.map((a) => <option key={a}>{a}</option>)}
        </select>
        <input style={s.input} placeholder="condition" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
        <select style={s.select} value={form.effect} onChange={(e) => setForm({ ...form, effect: e.target.value })}>
          {EFFECTS.map((e) => <option key={e}>{e}</option>)}
        </select>
        <input style={s.input} placeholder="reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        {!!addError && <div style={{ fontSize: "10px", color: "#ff4444" }}>{addError}</div>}
        <button style={s.btn} onClick={addPolicy}>+ Add Rule</button>
      </div>

      {!!actionError && <div style={{ fontSize: "10px", color: "#ff4444" }}>{actionError}</div>}

      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        {loading && <div style={{ fontSize: "10px", color: "#4a6080" }}>Loading rules...</div>}
        {!!fetchError && <div style={{ fontSize: "10px", color: "#ff4444" }}>{fetchError}</div>}
        {!loading && !fetchError && policies.length === 0 && (
          <div style={{ fontSize: "10px", color: "#4a6080" }}>No rules defined yet.</div>
        )}
        {policies.map((p) => (
          <div key={p.id} style={s.ruleCard(p.active)}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={s.tag("#4a90a4")}>{p.action}</span>
              <div style={{ display: "flex", gap: "4px" }}>
                <button style={{...s.smallBtn(p.active ? "#00ff88" : "#4a6080"), opacity: togglingId === p.id ? 0.5 : 1, cursor: togglingId === p.id ? "not-allowed" : "pointer"}} disabled={togglingId === p.id} onClick={() => togglePolicy(p.id)}>{p.active ? "ON" : "OFF"}</button>
                <button style={s.smallBtn("#ff4444")} onClick={() => deletePolicy(p.id)}>DEL</button>
              </div>
            </div>
            <div style={{ color: "#6a8a9a", fontSize: "10px", marginBottom: "3px" }}>{p.condition}</div>
            <div style={{ display: "flex", gap: "4px" }}>
              <span style={s.tag(p.effect === "BLOCK" ? "#ff4444" : "#ffaa00")}>{p.effect}</span>
              <span style={{ color: "#4a6080", fontSize: "10px" }}>{p.reason}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}