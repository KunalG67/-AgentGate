import PolicyEditor from "./components/PolicyEditor";
import LiveFeed from "./components/LiveFeed";
import AuditLog from "./components/AuditLog";
import SandboxPanel from "./components/SandboxPanel";
import PermissionsPanel from "./components/PermissionsPanel";
import { useState, useEffect } from "react";
import axios from "axios";

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// URLs to ignore in the 401 interceptor
const IGNORE_401_URLS = [
  "/auth/connected-services",
  "/auth/revoke",
];

export default function App() {
  const [showSandbox, setShowSandbox] = useState(false);
  const [showPerms, setShowPerms] = useState(false);
  const [authStatus, setAuthStatus] = useState("checking");

  // Axios interceptor — catches ANY 401 except ignored URLs
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        const url = error?.config?.url || "";
        const isIgnored = IGNORE_401_URLS.some(ignored => url.includes(ignored));
        if (error?.response?.status === 401 && !isIgnored) {
          setAuthStatus("disconnected");
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  // Check auth status on load
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setAuthStatus("disconnected");
    }, 10000); // 10 second timeout

    axios.get(`${API}/auth/status`, { withCredentials: true })
      .then(res => {
        clearTimeout(timeoutId);
        if (res.data?.logged_in) {
          setAuthStatus("connected");
        } else {
          setAuthStatus("disconnected");
        }
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if (error.response?.status === 401) {
          setAuthStatus("disconnected");
        }
      });
  }, []);

  // Check session every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      axios.get(`${API}/auth/status`, { withCredentials: true })
        .then(res => {
          if (!res.data?.logged_in) {
            setAuthStatus("disconnected");
          }
        })
        .catch(error => {
          if (error.response?.status === 401) {
            setAuthStatus("disconnected");
          }
        });
    }, 60000);
    return () => clearInterval(interval);
  }, [authStatus]); // Include authStatus dependency to recreate interval when auth changes

  return (
    <div style={{
      height: "100vh",
      overflow: "hidden",
      backgroundColor: "#0a0a0f",
      backgroundImage: `
        linear-gradient(rgba(0,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px)
      `,
      backgroundSize: "40px 40px",
      color: "#00ff88",
      fontFamily: "monospace",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>

      {/* Session Expired Banner */}
      {authStatus === "disconnected" && (
        <div style={{
          width: "100%",
          backgroundColor: "rgba(239,68,68,0.15)",
          border: "1px solid #ef4444",
          color: "#ef4444",
          fontFamily: "monospace",
          fontSize: "12px",
          letterSpacing: "1px",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <span>⚠ SESSION EXPIRED — You are not authenticated. Dashboard data may be unavailable.</span>
          <a href={`${API}/login`} style={{
            border: "1px solid #ef4444",
            color: "#ef4444",
            padding: "4px 12px",
            fontFamily: "monospace",
            fontSize: "12px",
            letterSpacing: "1px",
            textDecoration: "none",
            cursor: "pointer",
            marginLeft: "16px",
            whiteSpace: "nowrap"
          }}>LOGIN AGAIN</a>
        </div>
      )}

      {/* Header */}
      <div>
        {/* ROW 1: Top Strip */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 24px",
          height: "24px",
          background: "#0a0a0f",
          borderBottom: "1px solid rgba(255, 0, 255, 0.2)"
        }}>
          {/* LEFT: Hackathon badge */}
          <span style={{
            fontSize: "11px",
            color: "rgba(255, 0, 255, 0.6)",
            fontFamily: "monospace",
            letterSpacing: "3px"
          }}>
            AUTH0 HACKATHON 2026
          </span>

          {/* RIGHT: Status badges */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Auth0 Status Badge */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid rgba(0, 255, 255, 0.4)",
              borderRadius: "4px",
              padding: "2px 8px",
              background: "rgba(0, 255, 255, 0.05)"
            }}>
              <span style={{
                height: "6px",
                width: "6px",
                borderRadius: "50%",
                backgroundColor: authStatus === "connected" ? "#00ff00" : authStatus === "checking" ? "#eab308" : "#ef4444",
                boxShadow: authStatus === "connected" ? "0 0 6px #00ff00, 0 0 12px #00ff00" : "none"
              }}/>
              <span style={{
                fontSize: "10px",
                color: "#00ffff",
                fontFamily: "monospace",
                letterSpacing: "1.5px"
              }}>
                {authStatus === "connected" ? "AUTH0 CONNECTED" : authStatus === "checking" ? "AUTH0 CHECKING" : "AUTH0 DISCONNECTED"}
              </span>
            </div>

            {/* System Status Badge */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid rgba(0, 255, 255, 0.4)",
              borderRadius: "4px",
              padding: "2px 8px",
              background: "rgba(0, 255, 255, 0.05)"
            }}>
              <span style={{
                height: "6px",
                width: "6px",
                borderRadius: "50%",
                backgroundColor: "#00ff00",
                boxShadow: "0 0 6px #00ff00, 0 0 12px #00ff00"
              }}/>
              <span style={{
                fontSize: "10px",
                color: "#00ffff",
                fontFamily: "monospace",
                letterSpacing: "1.5px"
              }}>
                SYSTEM STATUS OPERATIONAL
              </span>
            </div>
          </div>
        </div>

        {/* ROW 2: Main Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          borderBottom: "1px solid rgba(0, 255, 255, 0.15)",
          position: "relative"
        }}>
          {/* LEFT: Brand */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <h1 style={{
              fontSize: "28px",
              fontWeight: 700,
              fontFamily: "monospace",
              letterSpacing: "2px",
              margin: 0,
              lineHeight: 1.2,
              background: "linear-gradient(90deg, #00ffff, #ff00ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              textShadow: "0 0 20px rgba(0, 255, 255, 0.4)"
            }}>
              AGENTGATE
            </h1>
            <p style={{
              fontSize: "13px",
              color: "#8892a4",
              fontFamily: "monospace",
              letterSpacing: "1px",
              margin: 0
            }}>
              Zero-Trust Execution Layer for AI Agents
              <span style={{
                color: "#00ffff",
                animation: "blink 1s step-end infinite"
              }}>|</span>
            </p>
          </div>

          {/* RIGHT: Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* RE-LOGIN Button */}
            <a
              href={`${API}/login`}
              style={{
                border: "1px solid #ff00ff",
                borderRadius: "4px",
                background: "rgba(255, 0, 255, 0.08)",
                color: "#ff00ff",
                padding: "8px 16px",
                fontFamily: "monospace",
                fontSize: "11px",
                letterSpacing: "2px",
                textDecoration: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(255, 0, 255, 0.2)";
                e.target.style.boxShadow = "0 0 12px rgba(255, 0, 255, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(255, 0, 255, 0.08)";
                e.target.style.boxShadow = "none";
              }}
            >
              RE-LOGIN
            </a>

            {/* PERMISSIONS Button */}
            <button
              onClick={() => setShowPerms(true)}
              style={{
                border: "1px solid #00ffff",
                borderRadius: "4px",
                background: "rgba(0, 255, 255, 0.08)",
                color: "#00ffff",
                padding: "8px 16px",
                fontFamily: "monospace",
                fontSize: "11px",
                letterSpacing: "2px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(0, 255, 255, 0.2)";
                e.target.style.boxShadow = "0 0 12px rgba(0, 255, 255, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(0, 255, 255, 0.08)";
                e.target.style.boxShadow = "none";
              }}
            >
              PERMISSIONS
            </button>

            {/* Execution Lab Button */}
            <button
              onClick={() => setShowSandbox(!showSandbox)}
              style={{
                border: "1px solid #00ffff",
                borderRadius: "4px",
                background: "rgba(0, 255, 255, 0.08)",
                color: "#00ffff",
                padding: "8px 16px",
                fontFamily: "monospace",
                fontSize: "11px",
                letterSpacing: "2px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.target.style.background = "rgba(0, 255, 255, 0.2)";
                e.target.style.boxShadow = "0 0 12px rgba(0, 255, 255, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.target.style.background = "rgba(0, 255, 255, 0.08)";
                e.target.style.boxShadow = "none";
              }}
            >
              EXECUTION LAB
            </button>
          </div>

          {/* Decorative gradient line */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "1px",
            background: "linear-gradient(90deg, transparent, #00ffff, #ff00ff, transparent)"
          }}/>
        </div>
      </div>

      {/* Blink animation */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>

      {/* 3-Panel Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "1rem",
        flex: 1,
        overflow: "hidden",
        minHeight: 0
      }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <PolicyEditor />
        </div>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <LiveFeed />
        </div>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <AuditLog />
        </div>
      </div>

      {showSandbox && <SandboxPanel onClose={() => setShowSandbox(false)} />}

      {/* Permissions Modal */}
      {showPerms && (
        <div 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.85)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onClick={() => setShowPerms(false)}
        >
          <div 
            style={{
              background: "#0a0f1a",
              border: "1px solid rgba(0,255,255,0.3)",
              borderRadius: "8px",
              padding: "24px",
              width: "480px",
              maxWidth: "90vw",
              position: "relative"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowPerms(false)}
              style={{
                position: "absolute",
                top: "12px",
                right: "16px",
                background: "transparent",
                border: "none",
                color: "#ff00ff",
                cursor: "pointer",
                fontSize: "18px",
                fontFamily: "monospace"
              }}
            >
              ✕
            </button>
            <PermissionsPanel />
          </div>
        </div>
      )}
    </div>
  );
}
