import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const TOKEN_KEY = "kinokontroll_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const authHeaders = () => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export const wsUrl = (room) => {
  const url = new URL(BACKEND_URL);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const r = encodeURIComponent(room || "default");
  return `${protocol}//${url.host}/api/ws?room=${r}`;
};

export const streamUrl = (videoId) => `${API}/videos/${videoId}/stream`;
export const thumbUrl = (videoId) => `${API}/videos/${videoId}/thumbnail`;
