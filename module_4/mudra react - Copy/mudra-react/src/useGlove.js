import { useCallback, useEffect, useRef, useState } from "react";
import { CUSTOM_GESTURES } from "./gestures.js";

const DEFAULT_WS_URL = "ws://192.168.1.10:8080";
const WS_URL = String(import.meta.env.VITE_WS_URL || "").trim() || DEFAULT_WS_URL;

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
const MODE_TIMEOUT_MS = 5000;
const SEEN_LIMIT = 50;

const GESTURES = ["HELLO WATER", "HELP NEED", "THANK YOU", "HELLO", ...CUSTOM_GESTURES];
const rand = () => 10 + Math.floor(Math.random() * 85);

const isPacket = (p) =>
  p &&
  typeof p.gesture === "string" &&
  Array.isArray(p.flex) &&
  p.flex.length === 5 &&
  p.flex.every(Number.isFinite) &&
  Number.isFinite(p.confidence);

export default function useGlove() {
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState(null);
  const [packet, setPacket] = useState({ gesture: "", flex: [12, 18, 16, 14, 11], confidence: 0 });
  const [history, setHistory] = useState([]);
  const [kw, setKw] = useState(null);
  const [fb, setFb] = useState(null);
  const [emergencySentence, setEmergencySentence] = useState(null);
  const [emergencyMode, setConfirmedEmergency] = useState("NORMAL");
  const [modeChanging, setModeChanging] = useState(false);

  const wsRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retryDelayRef = useRef(RETRY_MIN_MS);
  const modeTimerRef = useRef(null);
  const stoppedRef = useRef(false);
  const seenRef = useRef(new Set());
  const tickRef = useRef(0);
  const kwIdRef = useRef(0);
  const fbIdRef = useRef(0);
  const emgIdRef = useRef(0);

  const clearModeTimer = useCallback(() => {
    if (modeTimerRef.current) clearTimeout(modeTimerRef.current);
    modeTimerRef.current = null;
  }, []);

  const push = useCallback((p) => {
    setPacket(p);
    tickRef.current += 1;
    const t = tickRef.current;
    const avg = p.flex.reduce((a, b) => a + b, 0) / p.flex.length;
    setHistory((h) => [...h.slice(-39), { t, v: Math.round(avg) }]);
  }, []);

  const handleMessage = useCallback(
    (raw) => {
      let data;
      try {
        if (typeof raw !== "string") throw new Error("not text");
        data = JSON.parse(raw);
      } catch {
        setError("Ignored a malformed message from Module 3.");
        return;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        setError("Ignored an unexpected message format from Module 3.");
        return;
      }

      switch (data.type) {
        case "ERROR": {
  clearModeTimer();
  setModeChanging(false);
  setError(`Module 3: ${data.message || data.code || "Unknown error"}`);
  return;
        }
        case "EMERGENCY_RESULT": {
          if (data.mode !== undefined && data.mode !== "EMERGENCY") return;
          if (data.status !== "MATCH") return;
          const sentence = typeof data.sentence === "string" ? data.sentence.trim() : "";
          if (!sentence) return;
          const seq = data.sequence_id;
          if (typeof seq === "number" || (typeof seq === "string" && seq !== "")) {
            if (seenRef.current.has(seq)) return;
            seenRef.current.add(seq);
            if (seenRef.current.size > SEEN_LIMIT) {
              seenRef.current.delete(seenRef.current.values().next().value);
            }
          }
          setEmergencySentence({ id: ++emgIdRef.current, sequenceId: seq ?? null, sentence });
          return;
        }

        case "EMERGENCY_MODE_STATUS": {
  clearModeTimer();
  setModeChanging(false);

  if (typeof data.active !== "boolean") {
    setError("Invalid Emergency Mode response from Module 3.");
    return;
  }

  setConfirmedEmergency(data.active ? "EMERGENCY" : "NORMAL");
  setError(null);
  return;
}
        

        case "fallback_sentence":
        case "fallback_phrase": {
          const phrase = String(data.sentence || data.phrase || "").trim();
          if (phrase) setFb({ id: ++fbIdRef.current, phrase });
          return;
        }

        default:
          if (isPacket(data)) push(data);
      }
    },
    [clearModeTimer, push]
  );

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    const current = wsRef.current;
    if (current && (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN)) return;

    clearTimeout(retryTimerRef.current);
    setStatus("Connecting");

    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      setStatus("Error");
      setError(`Invalid WebSocket address: ${WS_URL}`);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      retryDelayRef.current = RETRY_MIN_MS;
      seenRef.current.clear();
      setStatus("Connected");
      setError(null);
    };

    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      handleMessage(e.data);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setStatus("Error");
      setError(`Could not reach Module 3 at ${WS_URL}.`);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearModeTimer();
      setModeChanging(false);
      setConfirmedEmergency("NORMAL");
      setStatus((s) => (s === "Error" ? s : "Disconnected"));
      if (stoppedRef.current) return;
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS);
      retryTimerRef.current = setTimeout(connect, delay);
    };
  }, [handleMessage, clearModeTimer]);

  useEffect(() => {
    stoppedRef.current = false;
    connect();
    return () => {
      stoppedRef.current = true;
      clearTimeout(retryTimerRef.current);
      clearModeTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
    };
  }, [connect, clearModeTimer]);

  const setEmergencyMode = useCallback(
    (enabled) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Not connected to Module 3. The mode was not changed.");
        return false;
      }
      if (modeTimerRef.current) return false;
      try {
        ws.send(JSON.stringify({
  type: enabled
    ? "ACTIVATE_EMERGENCY_MODE"
    : "DEACTIVATE_EMERGENCY_MODE"
}));
      } catch {
        setError("Could not send the mode change to Module 3.");
        return false;
      }
      setError(null);
      setModeChanging(true);
      modeTimerRef.current = setTimeout(() => {
        modeTimerRef.current = null;
        setModeChanging(false);
        setError("Module 3 did not confirm the mode change.");
      }, MODE_TIMEOUT_MS);
      return true;
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  const simulate = useCallback(() => {
    const unsure = Math.random() < 0.2;
    push({
      gesture: unsure ? "UNKNOWN" : GESTURES[Math.floor(Math.random() * GESTURES.length)],
      flex: Array.from({ length: 5 }, rand),
      confidence: unsure ? 0.3 + Math.random() * 0.3 : 0.9 + Math.random() * 0.09,
    });
  }, [push]);

  return {
    packet,
    history,
    live: status === "Connected",
    simulate,
    kw,
    fb,
    connectionStatus: status,
    recognizedKeywords: kw,
    emergencySentence,
    emergencyMode,
    modeChanging,
    error,
    clearError,
    setEmergencyMode,
  };
}