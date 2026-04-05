import { useEffect, useState } from "react";
import axios from "axios";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

const s = {
  label: {
    color: "#00ffff",
    letterSpacing: "3px",
    fontSize: "11px",
    fontFamily: "monospace",
    borderLeft: "2px solid #ff00ff",
    paddingLeft: "10px",
    marginBottom: "16px",
    textTransform: "uppercase"
  },
  message: {
    color: "#8892a4",
    fontSize: "12px",
    marginBottom: "16px",
    fontFamily: "monospace",
    lineHeight: "1.4"
  },
  card: (isConnected) => ({
    background: "rgba(0, 255, 255, 0.03)",
    border: `1px solid ${isConnected ? "rgba(0, 255, 0, 0.3)" : "rgba(0, 255, 255, 0.15)"}`,
    borderRadius: "4px",
    padding: "12px 16px",
    marginBottom: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  }),
  serviceName: {
    color: "#00ffff",
    fontFamily: "monospace",
    letterSpacing: "1px",
    fontSize: "13px",
    fontWeight: 500
  },
  scopes: {
    color: "#8892a4",
    fontSize: "11px",
    marginTop: "4px",
    fontFamily: "monospace"
  },
  badgeConnected: {
    border: "1px solid rgba(0, 255, 0, 0.5)",
    color: "#00ff00",
    background: "rgba(0, 255, 0, 0.08)",
    letterSpacing: "1px",
    fontSize: "11px",
    padding: "3px 10px",
    borderRadius: "4px",
    boxShadow: "0 0 8px rgba(0, 255, 0, 0.3)",
    fontFamily: "monospace"
  },
  badgePending: {
    border: "1px solid rgba(255, 165, 0, 0.5)",
    color: "#ffa500",
    background: "rgba(255, 165, 0, 0.08)",
    letterSpacing: "1px",
    fontSize: "11px",
    padding: "3px 10px",
    borderRadius: "4px",
    animation: "pulse 2s ease-in-out infinite",
    fontFamily: "monospace"
  },
  loading: {
    color: "#00ffff",
    letterSpacing: "2px",
    fontSize: "11px",
    fontFamily: "monospace"
  }
};

const allServices = [
  { service: "GMAIL", scopes: ["read:email", "send:email"] },
  { service: "GITHUB", scopes: ["repo:read", "repo:write", "repo:delete"] },
];

export default function PermissionsPanel() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API}/auth/connected-services`, { withCredentials: true })
      .then(r => setServices(r.data.services || []))
      .catch(e => { console.error("connected-services error:", e); setServices([]); })
      .finally(() => setLoading(false));
  }, []);

  const connectedSet = new Set(services.map(s => s.service?.toUpperCase()));

  return (
    <div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      
      <div style={s.label}>Agent Permissions</div>

      {loading ? (
        <div style={s.loading}>SCANNING CONNECTIONS...</div>
      ) : services.length === 0 ? (
        <div style={s.message}>
          Connect your services through the Auth0 login flow to grant AgentGate access to Gmail and GitHub.
        </div>
      ) : null}

      {allServices.map((svc) => {
        const isConnected = connectedSet.has(svc.service);
        return (
          <div key={svc.service} style={s.card(isConnected)}>
            <div>
              <div style={s.serviceName}>{svc.service}</div>
              <div style={s.scopes}>{svc.scopes.join(", ")}</div>
            </div>
            <span style={isConnected ? s.badgeConnected : s.badgePending}>
              {isConnected ? "CONNECTED" : "MANAGED BY AUTH0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
