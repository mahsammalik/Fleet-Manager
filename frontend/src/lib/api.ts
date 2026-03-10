import axios from "axios";
import { useAuthStore } from "../store/authStore";

const apiBaseURL =
  import.meta.env.VITE_API_URL ?? "http://localhost:4100/api";

export const api = axios.create({
  baseURL: apiBaseURL,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

