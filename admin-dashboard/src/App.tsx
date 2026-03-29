import { useEffect, useState } from 'react';
import { Activity, Cpu, Server, Shield, DownloadCloud, AlertTriangle, FileJson, FileSpreadsheet, HardDrive, CheckCircle } from 'lucide-react';

interface TelemetryLog {
  id: string;
  created_at: string;
  device_id: string;
  status: string;
  cpu_usage: number;
  memory_usage: number;
  fps: number;
  faces_detected: number;
  pii_detected: number;
  pii_labels: string;
}

export default function App() {
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [driveToken, setDriveToken] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/telemetry');
        if (res.ok) {
          const data = await res.json();
          setLogs(data);
        }
      } catch (err) {
        console.warn("Failed to fetch telemetry from local server:", err);
      }
    };

    fetchHistory();

    const intervalId = window.setInterval(() => {
      fetchHistory();
    }, 2000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
      const script = document.createElement('script');
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, []);

  const latest = logs[logs.length - 1] || null;
  const isOnline = latest && new Date().getTime() - new Date(latest.created_at).getTime() < 30000;

  const maxFacesInFrame = logs.reduce((acc, l) => Math.max(acc, l.faces_detected), 0);
  const totalFaces = Math.max(0, maxFacesInFrame - 1);
  const totalPII = logs.reduce((acc, l) => Math.max(acc, l.pii_detected), 0);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `telemetry_${new Date().toISOString()}.json`);
  };

  const getCSVString = () => {
    if (!logs.length) return "";
    const header = Object.keys(logs[0]).join(',');
    const rows = logs.map(l => Object.values(l).map(val => `"${val}"`).join(','));
    return [header, ...rows].join('\n');
  };

  const exportCSV = () => {
    const csv = getCSVString();
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, `telemetry_${new Date().toISOString()}.csv`);
  };

  const handleConnectGoogle = () => {
    const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '735910198084-jse0qi7mhv97mva9d62eaodoakdg9blg.apps.googleusercontent.com';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (response: any) => {
        if (response.error !== undefined) {
          alert("Google Auth Error: " + response.error);
          return;
        }
        setDriveToken(response.access_token);
      }
    });
    client.requestAccessToken();
  };

  const handleUploadToDrive = async () => {
    if (!driveToken) {
      alert("Please connect your Google Account first.");
      return;
    }
    if (!logs.length) {
      alert("No telemetry logs to upload.");
      return;
    }
    setIsUploading(true);

    const csvData = getCSVString();
    const boundary = "-------314159265358979323846";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify({ name: `EdgeAI_Telemetry_${new Date().toISOString()}.csv`, mimeType: 'text/csv' }) +
      delimiter +
      'Content-Type: text/csv\r\n\r\n' +
      csvData +
      close_delim;

    try {
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + driveToken,
          'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: multipartRequestBody
      });

      if (res.ok) {
        alert("Success! File uploaded to your Google Drive.");
      } else {
        const errJson = await res.json();
        alert("Upload failed: " + (errJson.error?.message || res.statusText));
      }
    } catch (e) {
      console.error(e);
      alert("Upload failed. Please check the console.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E4E4E7] font-sans selection:bg-blue-500/30">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
              <Server size={20} />
            </div>
            <div>
              <h1 className="font-semibold tracking-tight">Admin OS <span className="text-blue-500 font-bold">Terminal</span></h1>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Edge-AI Shield Global Monitor</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border border-white/10 rounded-full px-3 py-1.5 bg-white/5">
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-xs font-mono tracking-wider">{isOnline ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard icon={<Cpu className="text-orange-500" />} label="CPU OVERHEAD" value={`${latest?.cpu_usage || 0}%`} trend="Last Scan" />
          <MetricCard icon={<Activity className="text-blue-500" />} label="MEMORY MAPPED" value={`${latest ? Math.round(latest.memory_usage / 1048576) : 0} MB`} trend="V8 Heap" />
          <MetricCard icon={<Shield className="text-green-500" />} label="FACES SHIELDED" value={totalFaces.toString()} trend="Session Peak" />
          <MetricCard icon={<AlertTriangle className="text-red-500" />} label="PII BLOCKED" value={totalPII.toString()} trend="Session Peak" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col justify-center">
            <h3 className="text-sm font-semibold mb-6 flex items-center gap-2">
              <HardDrive size={16} className="text-blue-500" />
              Google Drive Cloud Sync
            </h3>

            <div className="flex flex-col gap-6 max-w-xl">
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider font-semibold mb-2 block">Step 1: Authenticate</label>
                  <button
                    onClick={handleConnectGoogle}
                    className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${driveToken ? 'bg-green-500/10 text-green-500 border border-green-500/30' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                      }`}
                  >
                    {driveToken ? <><CheckCircle size={16} /> Connected to Google Account</> : 'Connect Google Account'}
                  </button>
                  <p className="text-[10px] text-white/40 font-mono mt-2">Requires Google Drive API scoped to `https://www.googleapis.com/auth/drive.file`</p>
                </div>

                <div className="h-px w-full bg-white/10" />

                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider font-semibold mb-2 block">Step 2: Sync Dataset</label>
                  <p className="text-xs text-white/40 mb-4">You can manually push the latest {logs.length} edge-ai telemetry logs securely to your authenticated drive account.</p>

                  <button
                    onClick={handleUploadToDrive}
                    disabled={!driveToken || isUploading}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold text-sm hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all"
                  >
                    <DownloadCloud size={18} />
                    {isUploading ? 'UPLOADING RECORD...' : 'PUSH TO GOOGLE DRIVE'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col">
            <h3 className="text-sm font-semibold mb-6 flex items-center gap-2">
              <DownloadCloud size={16} className="text-purple-500" />
              Local Export Utilities
            </h3>
            <p className="text-xs text-white/50 mb-6 flex-1">
              Extract real-time logs for offline analysis or local archiving. The dataset includes high-fps frames context, CPU limits, and active PII captures scaled via Edge-AI.
            </p>

            <div className="space-y-3">
              <button onClick={exportJSON} className="w-full flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10 hover:border-blue-500/50 hover:bg-white/5 transition-all group">
                <div className="flex items-center gap-3">
                  <FileJson size={18} className="text-white/40 group-hover:text-blue-500 transition-colors" />
                  <span className="text-sm font-medium">Export Local JSON</span>
                </div>
                <span className="text-[10px] font-mono text-white/30 group-hover:text-blue-500/50">RAW DUMP</span>
              </button>

              <button onClick={exportCSV} className="w-full flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10 hover:border-green-500/50 hover:bg-white/5 transition-all group">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet size={18} className="text-white/40 group-hover:text-green-500 transition-colors" />
                  <span className="text-sm font-medium">Export Local CSV</span>
                </div>
                <span className="text-[10px] font-mono text-white/30 group-hover:text-green-500/50">TABULAR</span>
              </button>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}

function MetricCard({ icon, label, value, trend }: { icon: import('react').ReactNode, label: string, value: string, trend: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-colors cursor-default">
      <div className="flex items-center justify-between mb-4">
        {icon}
        <span className="text-[9px] font-mono text-white/30 uppercase">{trend}</span>
      </div>
      <div>
        <p className="text-[10px] font-bold tracking-widest text-white/50 uppercase mb-1">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
      </div>
    </div>
  );
}
