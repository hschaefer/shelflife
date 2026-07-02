import { Power, Sun, Moon, Database, RefreshCw, CheckCircle2, Clock } from "lucide-react";
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


  return (
    <div className="flex flex-col gap-6 font-sans max-w-4xl">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">System Configuration</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-tight">Manage your instance preferences and system-wide settings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Server & App Info Section */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Server & App Info</h4>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Endpoint Address</span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 break-all">{config?.url || 'Relative Host'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Application Version</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{packageJson.version}</span>
              </div>
            </div>
          </div>

          {onDisconnect && isDirect && (
            <button 
              onClick={onDisconnect}
              className="w-full py-2 bg-rose-50 dark:bg-rose-955/20 text-rose-600 dark:text-rose-500 border border-rose-100 dark:border-rose-900/30 hover:bg-rose-100/75 dark:hover:bg-rose-900/20 rounded-md text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all mt-4 cursor-pointer"
            >
              <Power size={12} />
              Disconnect Server
            </button>
          )}
        </div>

        {/* Cache Settings Section */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
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



            {/* Sync Session Data Preference Toggle Switch (Android Native / Direct connection mode only) */}
            {isDirect && (
              <div className="flex items-center justify-between py-3 px-3 mb-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800 rounded-md transition-all hover:border-slate-300 dark:hover:border-slate-800">
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
                    syncSessionsEnabled ? "bg-indigo-650" : "bg-slate-200 dark:bg-slate-800"
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
            <div className="flex items-center justify-between text-xs font-semibold py-2 px-3 bg-slate-50 dark:bg-slate-955 border border-slate-200/50 dark:border-slate-800 rounded-md">
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
              "w-full py-2 rounded-md text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all mt-5 cursor-pointer border",
              isSyncing 
                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed" 
                : isSyncSuccess
                  ? "bg-emerald-50 dark:bg-emerald-955/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/30"
                  : "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white border-transparent shadow-none"
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
            <div className="mt-4 bg-slate-50 dark:bg-slate-955 border border-slate-200/50 dark:border-slate-800/80 rounded-md p-3.5 animate-fade-in">
              <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
                <span className="truncate pr-3">
                  {syncProgress.type === 'books' 
                    ? `Caching ${syncProgress.libraryName || 'Library'} Books` 
                    : 'Syncing listening history'}
                </span>
                <span className="font-mono text-indigo-650 dark:text-indigo-400 shrink-0">{syncProgress.percentage}%</span>
              </div>
              
              <div className="w-full bg-slate-250 dark:bg-slate-900 rounded-full h-1 overflow-hidden mb-2">
                <div 
                  className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out" 
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
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[300px]">
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
                  "flex flex-col items-center justify-center p-4 rounded-md border text-center transition-all cursor-pointer gap-2",
                  !darkMode 
                    ? "border-indigo-600 bg-indigo-50/35 text-indigo-600 dark:text-indigo-400 font-bold" 
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400"
                )}
              >
                <div className={cn("p-2 rounded-md", !darkMode ? "bg-indigo-100/80 text-indigo-600" : "bg-slate-100 dark:bg-slate-800 text-slate-500")}>
                  <Sun size={20} />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold leading-none">Light</span>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-medium font-sans">Clean and radiant layout</span>
                </div>
              </button>

              <button 
                onClick={() => setDarkMode?.(true)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-md border text-center transition-all cursor-pointer gap-2",
                  darkMode 
                    ? "border-indigo-600 dark:border-indigo-500 bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-bold" 
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400"
                )}
              >
                <div className={cn("p-2 rounded-md", darkMode ? "bg-indigo-950 text-indigo-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500")}>
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

      </div>
    </div>
  );
}
