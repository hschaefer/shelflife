import { Power, ShieldCheck, Sun, Moon, Database, BookOpen, History, RefreshCw, CheckCircle2, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import packageJson from "../../package.json";
import { Capacitor } from "@capacitor/core";
import { getItem, setItem } from "../lib/storage";

interface SettingsViewProps {
  onDisconnect?: () => void;
  onHeadersSaved?: () => void;
  darkMode?: boolean;
  setDarkMode?: (dark: boolean) => void;
  syncStatus?: any;
  syncProgress?: any;
  onSyncComplete?: (newStatus: any) => Promise<void>;
}

export function SettingsView({ 
  onDisconnect, 
  darkMode = false, 
  setDarkMode,
  syncStatus,
  syncProgress,
  onSyncComplete
}: SettingsViewProps) {
  const config = api.getConfig();
  const isNative = Capacitor.isNativePlatform();
  const isDirect = isNative;

  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncSuccess, setIsSyncSuccess] = useState(false);
  const [localSyncStatus, setLocalSyncStatus] = useState<any>(syncStatus);
  const [syncSessionsEnabled, setSyncSessionsEnabled] = useState(false);

  useEffect(() => {
    setLocalSyncStatus(syncStatus);
  }, [syncStatus]);

  useEffect(() => {
    async function loadSyncSessions() {
      const saved = await getItem("ABS_SYNC_SESSIONS");
      setSyncSessionsEnabled(saved === "true");
    }
    if (isDirect) {
      loadSyncSessions();
    }
  }, [isDirect]);

  const handleToggleSyncSessions = async (enabled: boolean) => {
    setSyncSessionsEnabled(enabled);
    await setItem("ABS_SYNC_SESSIONS", enabled ? "true" : "false");
    const freshStatus = await api.getSyncStatus();
    setLocalSyncStatus(freshStatus);
    if (onSyncComplete) {
      await onSyncComplete(freshStatus);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setIsSyncSuccess(false);
    try {
      // Trigger full sync
      await api.triggerSync(undefined, false, true);
      // Retrieve fresh status
      const freshStatus = await api.getSyncStatus();
      setLocalSyncStatus(freshStatus);
      setIsSyncSuccess(true);
      // Callback to reload all application stats/data
      if (onSyncComplete) {
        await onSyncComplete(freshStatus);
      }
      // Keep success state for 3 seconds
      setTimeout(() => setIsSyncSuccess(false), 3000);
    } catch (err) {
      console.error("Manual database sync failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const formatSyncTime = (timestamp: any) => {
    if (!timestamp || timestamp <= 0) return "Never Synced";
    try {
      return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
    } catch {
      return "Unknown";
    }
  };


  const currentExtraHeaders = config?.extraHeaders ?? {};
  const hasExtraHeaders = Object.keys(currentExtraHeaders).length > 0;

  return (
    <div className="flex flex-col gap-6 font-sans max-w-4xl">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">System Configuration</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-tight">Manage your instance preferences and system-wide settings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Connection Profile Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Node Connection</h4>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Endpoint Address</span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 break-all">{config?.url || 'Relative Host'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Connection Profile</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isNative 
                    ? 'Direct Client API (Android Native)' 
                    : 'Server Authenticated Proxy'}
                </span>
              </div>

              
              {isDirect && hasExtraHeaders && (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Active Auth Headers</span>
                    <div className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-[8px] font-extrabold uppercase flex items-center gap-0.5">
                      <ShieldCheck size={8} />
                      Active
                    </div>
                  </div>
                  <div className="space-y-1.5 mt-1 bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 rounded-xl p-3">
                    {Object.entries(currentExtraHeaders).map(([key]) => (
                      <div key={key} className="flex items-center justify-between text-[11px] font-medium font-sans">
                        <span className="font-semibold text-slate-600 dark:text-slate-400 font-mono break-all pr-2">{key}</span>
                        <span className="text-slate-400 dark:text-slate-500 font-mono text-[9px] shrink-0">••••••••</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {onDisconnect && isDirect && (
            <button 
              onClick={onDisconnect}
              className="w-full py-2.5 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-500 border border-rose-100 dark:border-rose-950/30 hover:bg-rose-100/70 dark:hover:bg-rose-900/20 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all shadow-sm mt-4 cursor-pointer active:scale-98"
            >
              <Power size={12} />
              Disconnect Server
            </button>
          )}
        </div>

        {/* Cache Settings Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Database Cache</h4>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-5">
              Manage cached audiobooks library data and listening sessions stored locally for offline access.
            </p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Library Cache Counter */}
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200/50 dark:border-slate-800/80 rounded-xl p-4 flex flex-col gap-1 hover:border-slate-300 dark:hover:border-slate-700/80 transition-all group">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Books & Items</span>
                  <BookOpen className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                </div>
                <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                  {localSyncStatus?.itemsCached ?? 0}
                </span>
                <span className="text-[8px] text-slate-400 dark:text-slate-500 font-medium">Items in local cache</span>
              </div>

              {/* Sessions Cache Counter */}
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200/50 dark:border-slate-800/80 rounded-xl p-4 flex flex-col gap-1 hover:border-slate-300 dark:hover:border-slate-700/80 transition-all group">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Sessions</span>
                  <History className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                </div>
                <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
                  {isDirect 
                    ? (syncSessionsEnabled ? (localSyncStatus?.sessionsCached ?? 0) : "Disabled")
                    : (localSyncStatus?.sessionsCached ?? 0)}
                </span>
                <span className="text-[8px] text-slate-400 dark:text-slate-500 font-medium">
                  {isDirect 
                    ? (syncSessionsEnabled ? "Sessions in local cache" : "Direct Connect mode")
                    : "Sessions in local cache"}
                </span>
              </div>
            </div>

            {/* Sync Session Data Preference Toggle Switch (Android Native / Direct connection mode only) */}
            {isDirect && (
              <div className="flex items-center justify-between py-3 px-3 mb-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850 rounded-xl transition-all hover:border-slate-300 dark:hover:border-slate-800">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Sync Session Data</span>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">
                    Cache listening sessions locally for offline stats
                  </span>
                </div>
                <button
                  onClick={() => handleToggleSyncSessions(!syncSessionsEnabled)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                    syncSessionsEnabled ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-800"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      syncSessionsEnabled ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            )}

            {/* Last Synced Row */}
            <div className="flex items-center justify-between text-xs font-semibold py-2.5 px-3 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-850 rounded-xl">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-sans">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[9px] uppercase tracking-wider font-extrabold">Last Synchronized</span>
              </div>
              <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px] font-bold">
                {formatSyncTime(localSyncStatus?.lastSync)}
              </span>
            </div>
          </div>

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className={cn(
              "w-full py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all shadow-sm mt-5 cursor-pointer active:scale-98 border",
              isSyncing 
                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed" 
                : isSyncSuccess
                  ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/30"
                  : "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white border-transparent shadow-indigo-100 dark:shadow-none"
            )}
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                Syncing Cache...
              </>
            ) : isSyncSuccess ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-500 animate-bounce" />
                Sync Successful!
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3" />
                Synchronize Cache
              </>
            )}
          </button>
          
          {isSyncing && syncProgress && (
            <div className="mt-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/80 rounded-xl p-3.5 shadow-inner animate-fade-in">
              <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
                <span className="truncate pr-3">
                  {syncProgress.type === 'books' 
                    ? `Caching ${syncProgress.libraryName || 'Library'} Books` 
                    : 'Syncing Listening History'}
                </span>
                <span className="font-mono text-indigo-650 dark:text-indigo-400 shrink-0">{syncProgress.percentage}%</span>
              </div>
              
              <div className="w-full bg-slate-200 dark:bg-slate-900 rounded-full h-1.5 overflow-hidden mb-2">
                <div 
                  className="bg-indigo-650 dark:bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out" 
                  style={{ width: `${syncProgress.percentage}%` }}
                />
              </div>
              
              <div className="flex justify-between items-center text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider">
                <span>Items Cache Loop</span>
                <span className="font-mono">{syncProgress.current} / {syncProgress.total}</span>
              </div>
            </div>
          )}
        </div>

        {/* Theme Settings Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Interface Theme</h4>
            </div>
            
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-6">
              Customize the visual look and feel of your audiobookshelf dashboard interface.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => setDarkMode?.(false)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-xl border text-center transition-all cursor-pointer gap-2",
                  !darkMode 
                    ? "border-indigo-600 bg-indigo-50/30 text-indigo-600 dark:text-indigo-400 font-bold shadow-sm shadow-indigo-100/30" 
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400"
                )}
              >
                <div className={cn("p-2 rounded-lg", !darkMode ? "bg-indigo-100/80 text-indigo-600" : "bg-slate-100 dark:bg-slate-800 text-slate-500")}>
                  <Sun size={20} />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold leading-none">Light</span>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-medium">Clean and radiant layout</span>
                </div>
              </button>

              <button 
                onClick={() => setDarkMode?.(true)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-xl border text-center transition-all cursor-pointer gap-2",
                  darkMode 
                    ? "border-indigo-600 dark:border-indigo-500 bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-bold shadow-sm" 
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400"
                )}
              >
                <div className={cn("p-2 rounded-lg", darkMode ? "bg-indigo-950 text-indigo-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500")}>
                  <Moon size={20} />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold leading-none">Dark</span>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-medium font-sans">Immersive slate system</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Version Info Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Version & Environment</h4>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Application Version</span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{packageJson.version}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Runtime Platform</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isNative ? 'Capacitor Native Shell' : 'Modern Browser App'}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Storage Provider</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isDirect ? 'IndexedDB Client Storage' : 'SQLite Server Database'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
