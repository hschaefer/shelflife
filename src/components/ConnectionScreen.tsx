import React, { useState } from "react";
import { 
  Globe, 
  Key, 
  User, 
  Lock, 
  Activity, 
  Check, 
  AlertCircle, 
  ArrowRight,
  ShieldAlert,
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import axios from "axios";
import { api } from "../lib/api";
import logoLight from "../../assets/icon.svg";
import logoDark from "../../assets/icon-dark.svg";

interface ConnectionScreenProps {
  onSuccess: () => void;
  isDark?: boolean;
}

/**
 * ConnectionScreen — Android/Native only.
 * 
 * On the web, the server provides the ABS connection via environment variables,
 * so this component is never rendered. On Android, users connect directly to
 * their Audiobookshelf instance by entering URL + credentials or API token.
 */
export function ConnectionScreen({ onSuccess, isDark = false }: ConnectionScreenProps) {
  const [url, setUrl] = useState("");
  const [authMethod, setAuthMethod] = useState<"credentials" | "token">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | ""; message: string }>({
    type: "",
    message: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [extraHeadersInput, setExtraHeadersInput] = useState("");

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setStatus({ type: "error", message: "Server URL is required." });
      return;
    }

    setLoading(true);
    setStatus({ type: "", message: "" });

    // Normalize URL
    let formattedUrl = url.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `http://${formattedUrl}`;
    }
    if (formattedUrl.endsWith("/")) {
      formattedUrl = formattedUrl.slice(0, -1);
    }

    try {
      let resolvedToken = "";

      // Parse and validate extra headers JSON (if provided)
      let parsedExtraHeaders: Record<string, string> | undefined;
      if (extraHeadersInput.trim()) {
        try {
          parsedExtraHeaders = JSON.parse(extraHeadersInput.trim());
          if (typeof parsedExtraHeaders !== "object" || Array.isArray(parsedExtraHeaders)) {
            throw new Error("Must be a JSON object");
          }
        } catch {
          setStatus({ type: "error", message: 'Extra Headers must be valid JSON, e.g. {"CF-Access-Client-Id": "...", "CF-Access-Client-Secret": "..."}' });
          setLoading(false);
          return;
        }
      }

      // Direct ABS connection — authenticate to get token
      if (authMethod === "credentials") {
        if (!username || !password) {
          setStatus({ type: "error", message: "Username and password are required." });
          setLoading(false);
          return;
        }

        const loginRes = await axios.post(
          `${formattedUrl}/login`,
          { username, password },
          { 
            headers: { 
              "Content-Type": "application/json",
              ...(parsedExtraHeaders ?? {}),
            }, 
            timeout: 8000 
          }
        );

        resolvedToken = loginRes.data?.user?.token;
        if (!resolvedToken) {
          throw new Error("Could not retrieve authentication token from server.");
        }
      } else {
        if (!token) {
          setStatus({ type: "error", message: "API Token is required." });
          setLoading(false);
          return;
        }
        resolvedToken = token.trim();
      }

      await api.saveConnection(formattedUrl, resolvedToken, parsedExtraHeaders);

      const health = await api.checkHealth();

      if (health.ok) {
        setStatus({ 
          type: "success", 
          message: "Successfully connected to Audiobookshelf!" 
        });
        setTimeout(() => {
          onSuccess();
        }, 1200);
      } else {
        await api.disconnect();
        setStatus({
          type: "error",
          message: health.error || "Connection verified, but authorization failed.",
        });
      }
    } catch (err: any) {
      console.error(err);
      await api.disconnect();
      let errorMsg = "Could not reach server. Verify the URL is correct and online.";
      
      if (err.response) {
        if (err.response.status === 401) {
          errorMsg = "Invalid username or password.";
        } else if (err.response.data?.error) {
          errorMsg = err.response.data.error;
        }
      } else if (err.code === "ECONNABORTED") {
        errorMsg = "Connection timed out. Check your network or URL.";
      }
      
      setStatus({
        type: "error",
        message: errorMsg,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6 selection:bg-indigo-100 dark:selection:bg-indigo-950 selection:text-indigo-900 dark:selection:text-indigo-200 transition-colors duration-200 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="max-w-md w-full bg-white dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-800 pt-5 pb-8 px-8 sm:pt-6 sm:pb-10 sm:px-10 relative overflow-hidden"
      >
        <div className="text-center mb-8">
          <motion.img 
            src={isDark ? logoDark : logoLight} 
            alt="ShelfLife Logo" 
            className="w-32 h-32 object-contain mx-auto mt-0 mb-1 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.15 }}
          />
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Shelf<span className="text-indigo-600 dark:text-indigo-400">Life</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider mt-1 font-sans">
            Connect your Audiobookshelf Server
          </p>
        </div>

        <form onSubmit={handleConnect} className="space-y-4">
          {/* Server URL Input */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
              Audiobookshelf URL
            </label>
            <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-md group focus-within:ring-1 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-950/30 focus-within:border-indigo-500 dark:focus-within:border-indigo-500 transition-all">
              <Globe size={14} className="text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors" />
              <input
                type="text"
                placeholder="https://abs.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                className="bg-transparent border-none text-xs font-semibold focus:ring-0 placeholder:text-slate-400 w-full outline-none text-slate-800 dark:text-slate-100"
                required
              />
            </div>
            <p className="text-[10px] text-slate-400/80 dark:text-slate-500/80 font-medium">
              E.g. http://192.168.1.50:5000 or domain address
            </p>
          </div>

          {/* Auth Method Selector */}
          <div className="grid grid-cols-2 gap-1 bg-slate-50 dark:bg-slate-950 p-1 rounded-md border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setAuthMethod("credentials")}
              disabled={loading}
              className={`py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                authMethod === "credentials"
                  ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-slate-200/50 dark:border-slate-700/50"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent"
              }`}
            >
              Credentials
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod("token")}
              disabled={loading}
              className={`py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                authMethod === "token"
                  ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-slate-200/50 dark:border-slate-700/50"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent"
              }`}
            >
              API Token
            </button>
          </div>

          {/* Dynamic Auth Forms */}
          <AnimatePresence mode="wait">
            {authMethod === "credentials" ? (
              <motion.div
                key="credentials"
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                {/* Username */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                    Username
                  </label>
                  <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-md group focus-within:ring-1 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-950/30 focus-within:border-indigo-500 dark:focus-within:border-indigo-500 transition-all">
                    <User size={14} className="text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors" />
                    <input
                      type="text"
                      placeholder="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={loading}
                      className="bg-transparent border-none text-xs font-semibold focus:ring-0 placeholder:text-slate-400 w-full outline-none text-slate-800 dark:text-slate-100"
                      required={authMethod === "credentials"}
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                    Password
                  </label>
                  <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-md group focus-within:ring-1 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-950/30 focus-within:border-indigo-500 dark:focus-within:border-indigo-500 transition-all">
                    <Lock size={14} className="text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors" />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      className="bg-transparent border-none text-xs font-semibold focus:ring-0 placeholder:text-slate-400 w-full outline-none text-slate-800 dark:text-slate-100"
                      required={authMethod === "credentials"}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="token"
                initial={{ opacity: 0, x: 5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
                transition={{ duration: 0.15 }}
                className="space-y-1.5"
              >
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                  API Token / Personal Access Token
                </label>
                <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-955 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-md group focus-within:ring-1 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-955/30 focus-within:border-indigo-500 dark:focus-within:border-indigo-500 transition-all">
                  <Key size={14} className="text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors" />
                  <input
                    type="password"
                    placeholder="Paste API token from User Settings"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={loading}
                    className="bg-transparent border-none text-xs font-semibold focus:ring-0 placeholder:text-slate-400 w-full outline-none text-slate-800 dark:text-slate-100"
                    required={authMethod === "token"}
                  />
                </div>
                <p className="text-[10px] text-slate-400/80 dark:text-slate-500/80 font-medium">
                  Can be generated in your Audiobookshelf User Profile under "API Tokens".
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Advanced / Extra Headers */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert size={13} className="text-slate-400 dark:text-slate-500" />
                Advanced
              </span>
              <ChevronDown
                size={14}
                className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${
                  showAdvanced ? "rotate-180" : ""
                }`}
              />
            </button>
            <AnimatePresence initial={false}>
              {showAdvanced && (
                <motion.div
                  key="advanced-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                      Extra Auth Headers (JSON)
                    </label>
                    <textarea
                      rows={3}
                      placeholder='{"CF-Access-Client-Id": "...", "CF-Access-Client-Secret": "..."}'
                      value={extraHeadersInput}
                      onChange={(e) => setExtraHeadersInput(e.target.value)}
                      disabled={loading}
                      spellCheck={false}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-[11px] font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400/70 dark:placeholder:text-slate-600 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 focus:border-indigo-400 dark:focus:border-indigo-500 transition-all"
                    />
                    <p className="text-[10px] text-slate-400/80 dark:text-slate-500 font-medium leading-relaxed">
                      Optional. For servers behind <span className="text-slate-500 dark:text-slate-400 font-semibold">Cloudflare Access</span>, paste your Service Token JSON.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Action Button & Status Info */}
          <div className="pt-2">
            <AnimatePresence mode="wait">
              {status.type && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className={`p-3.5 rounded-md flex items-start gap-3 mb-4 text-xs font-semibold ${
                    status.type === "success"
                      ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30"
                      : "bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30"
                  }`}
                >
                  {status.type === "success" ? (
                    <Check size={14} className="shrink-0 text-emerald-500 mt-0.5" />
                  ) : (
                    <AlertCircle size={14} className="shrink-0 text-rose-500 mt-0.5" />
                  )}
                  <div className="leading-relaxed">{status.message}</div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 group disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <Activity size={14} className="animate-spin" />
                  Connecting Instance...
                </>
              ) : (
                <>
                  Establish Link
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
