import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, ShieldOff, Eye, EyeOff, Settings, Activity, Power, AlertCircle, Cpu, Zap, Search, Lock, Download, Trash2 } from 'lucide-react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { GoogleGenAI, Type } from "@google/genai";

type Status = 'INACTIVE' | 'RUNNING';

interface SensitiveRegion {
  box_2d: [number, number, number, number];
  label: string;
}

interface LogEntry {
  timestamp: string;
  fps: number;
  cpuUsage: number;
  facesCount: number;
  piiCount: number;
  piiLabels: string;
}

const chromeMock = {
  runtime: {
    sendMessage: (message: any, callback?: (response: any) => void) => {
      console.log('Chrome Extension Send:', message);
      if (callback) {
        setTimeout(() => {
          if (message.type === 'START') callback({ status: 'RUNNING' });
          if (message.type === 'STOP') callback({ status: 'STOPPED' });
          if (message.type === 'GET_STATUS') callback({ status: 'INACTIVE' });
        }, 200);
      }
    },
    onMessage: {
      addListener: (callback: any) => {
        console.log('Listener added');
      }
    }
  }
};

const browser = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : chromeMock;

export default function App() {
  const [status, setStatus] = useState<Status>('INACTIVE');
  const [blurFaces, setBlurFaces] = useState(true);
  const [blurText, setBlurText] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fps, setFps] = useState(0);
  const [cpuUsage, setCpuUsage] = useState(0);
  const [detectionsCount, setDetectionsCount] = useState(0);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [sensitiveRegions, setSensitiveRegions] = useState<SensitiveRegion[]>([]);
  const [isScanningText, setIsScanningText] = useState(false);
  const [sessionLog, setSessionLog] = useState<LogEntry[]>([]);

  const totalObjects = detectionsCount + sensitiveRegions.length;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const lastDetectionsRef = useRef<Array<{ originX: number; originY: number; width: number; height: number }>>([]);
  const requestRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const cpuUsageRef = useRef(0);
  const fpsRef = useRef(0);
  const detectionsCountRef = useRef(0);
  const sensitiveRegionsRef = useRef<SensitiveRegion[]>([]);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_STATUS' }, (response: any) => {
      if (response && response.status) {
        setStatus(response.status === 'RUNNING' ? 'RUNNING' : 'INACTIVE');
      }
    });
  }, []);

  useEffect(() => { cpuUsageRef.current = cpuUsage; }, [cpuUsage]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { detectionsCountRef.current = detectionsCount; }, [detectionsCount]);
  useEffect(() => { sensitiveRegionsRef.current = sensitiveRegions; }, [sensitiveRegions]);

  useEffect(() => {
    setIsModelLoading(true);
    let detector: FaceDetector | null = null;

    const initDetector = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          './wasm'
        );
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: './models/blaze_face_short_range.tflite',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5
        });
        faceDetectorRef.current = detector;
        console.log('MediaPipe FaceDetector loaded successfully');
        setIsModelLoading(false);
      } catch (err) {
        console.error('Failed to initialize FaceDetector:', err);
        try {
          const vision = await FilesetResolver.forVisionTasks(
            './wasm'
          );
          detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: './models/blaze_face_short_range.tflite',
              delegate: 'CPU'
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.5
          });
          faceDetectorRef.current = detector;
          console.log('MediaPipe FaceDetector loaded with CPU delegate');
          setIsModelLoading(false);
        } catch (err2) {
          console.error('FaceDetector failed with CPU fallback too:', err2);
          setIsModelLoading(false);
        }
      }
    };

    initDetector();

    return () => {
      if (detector) {
        detector.close();
      }
    };
  }, []);

  useEffect(() => {
    let timeoutId: number | null = null;
    let isMounted = true;

    const scanForSensitiveText = async () => {
      if (!isMounted || status !== 'RUNNING' || !blurText || !canvasRef.current || isScanningText) {
        if (isMounted && status === 'RUNNING' && blurText) {
          timeoutId = window.setTimeout(scanForSensitiveText, 1000);
        }
        return;
      }

      setIsScanningText(true);
      try {
        const canvas = canvasRef.current;
        const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              parts: [
                {
                  text: "Analyze this image for highly sensitive private information. Identify the exact bounding boxes for: 1. Credit card numbers (16 digits), 2. Email addresses, 3. Phone numbers, 4. Social security numbers, 5. Passwords or API keys. Focus on the actual data values, not just the labels. Return the bounding boxes in [ymin, xmin, ymax, xmax] format (0-1000 range) and a descriptive label for each. Return ONLY a raw JSON array.",
                },
                {
                  inlineData: {
                    data: base64Image,
                    mimeType: "image/jpeg",
                  },
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  box_2d: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                    description: "[ymin, xmin, ymax, xmax] normalized to 1000",
                  },
                  label: { type: Type.STRING },
                },
                required: ["box_2d", "label"],
              },
            },
          },
        });

        if (response.text) {
          try {
            const jsonStr = response.text.replace(/```json\n?|\n?```/g, '').trim();
            const regions = JSON.parse(jsonStr) as SensitiveRegion[];
            setSensitiveRegions(regions);
          } catch (parseError) {
            console.error("Failed to parse AI response:", parseError, response.text);
          }
        }
      } catch (error) {
        console.error("AI Text Scan Error:", error);
      } finally {
        if (isMounted) {
          setIsScanningText(false);

          const currentCpu = cpuUsageRef.current;
          let nextDelay = 3000;

          if (currentCpu > 85) nextDelay = 15000;
          else if (currentCpu > 70) nextDelay = 10000;
          else if (currentCpu > 50) nextDelay = 7000;
          else if (currentCpu > 30) nextDelay = 5000;

          if (status === 'RUNNING' && blurText) {
            timeoutId = window.setTimeout(scanForSensitiveText, nextDelay);
          }
        }
      }
    };

    if (status === 'RUNNING' && blurText) {
      scanForSensitiveText();
    } else {
      setSensitiveRegions([]);
    }

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [status, blurText]);

  useEffect(() => {
    let intervalId: number | null = null;
    if (status === 'RUNNING') {
      intervalId = window.setInterval(() => {
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          fps: fpsRef.current,
          cpuUsage: cpuUsageRef.current,
          facesCount: detectionsCountRef.current,
          piiCount: sensitiveRegionsRef.current.length,
          piiLabels: sensitiveRegionsRef.current.map(r => r.label).join('; ')
        };
        setSessionLog(prev => {
          const newLog = [...prev, entry];
          if (newLog.length > 3600) return newLog.slice(-3600);
          return newLog;
        });
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [status]);

  const renderFrame = useCallback(() => {
    if (!canvasRef.current || !videoRef.current) return;
    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    canvasCtx.drawImage(videoRef.current, 0, 0, width, height);

    if (blurFaces && lastDetectionsRef.current.length > 0) {
      const detections = lastDetectionsRef.current;

      let largestFaceIndex = -1;
      let maxArea = 0;

      detections.forEach((bbox, index) => {
        const area = bbox.width * bbox.height;
        if (area > maxArea) {
          maxArea = area;
          largestFaceIndex = index;
        }
      });

      detections.forEach((bbox, index) => {
        const isUser = index === largestFaceIndex;
        const x = bbox.originX;
        const y = bbox.originY;
        const w = bbox.width;
        const h = bbox.height;

        if (!isUser) {
          canvasCtx.save();
          canvasCtx.beginPath();
          canvasCtx.rect(x, y, w, h);
          canvasCtx.clip();
          canvasCtx.filter = 'blur(30px) brightness(0.8)';
          canvasCtx.drawImage(videoRef.current!, 0, 0, width, height);

          canvasCtx.fillStyle = 'rgba(249, 115, 22, 0.2)';
          canvasCtx.fillRect(x, y, w, h);
          canvasCtx.restore();

          canvasCtx.strokeStyle = '#F97316';
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeRect(x, y, w, h);

          canvasCtx.fillStyle = '#F97316';
          canvasCtx.fillRect(x, y - 16, 60, 16);
          canvasCtx.fillStyle = '#000000';
          canvasCtx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
          canvasCtx.fillText('BLURRED', x + 6, y - 4);
        } else {
          canvasCtx.strokeStyle = '#10B981';
          canvasCtx.lineWidth = 2;
          canvasCtx.setLineDash([5, 5]);
          canvasCtx.strokeRect(x, y, w, h);
          canvasCtx.setLineDash([]);

          canvasCtx.fillStyle = '#10B981';
          canvasCtx.fillRect(x, y - 16, 45, 16);
          canvasCtx.fillStyle = '#FFFFFF';
          canvasCtx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
          canvasCtx.fillText('USER', x + 6, y - 4);
        }
      });
    }

    if (blurText && sensitiveRegions.length > 0) {
      sensitiveRegions.forEach((region) => {
        const [ymin, xmin, ymax, xmax] = region.box_2d;
        const rx = (xmin / 1000) * width;
        const ry = (ymin / 1000) * height;
        const rw = ((xmax - xmin) / 1000) * width;
        const rh = ((ymax - ymin) / 1000) * height;

        canvasCtx.save();
        canvasCtx.beginPath();
        canvasCtx.rect(rx, ry, rw, rh);
        canvasCtx.clip();

        canvasCtx.filter = 'blur(45px) contrast(1.1) brightness(0.7)';
        canvasCtx.drawImage(videoRef.current!, 0, 0, width, height);

        canvasCtx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        canvasCtx.fillRect(rx, ry, rw, rh);

        const scanY = ry + (Math.sin(Date.now() / 400) * 0.5 + 0.5) * rh;
        canvasCtx.strokeStyle = '#EF4444';
        canvasCtx.lineWidth = 2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(rx, scanY);
        canvasCtx.lineTo(rx + rw, scanY);
        canvasCtx.stroke();

        canvasCtx.restore();

        canvasCtx.strokeStyle = '#EF4444';
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeRect(rx, ry, rw, rh);

        const labelText = region.label.toUpperCase();
        canvasCtx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        const labelWidth = canvasCtx.measureText(labelText).width;

        canvasCtx.fillStyle = '#EF4444';
        canvasCtx.fillRect(rx, ry - 18, labelWidth + 12, 18);
        canvasCtx.fillStyle = '#FFFFFF';
        canvasCtx.fillText(labelText, rx + 6, ry - 5);
      });
    }
  }, [blurFaces, blurText, sensitiveRegions]);

  const processFrame = useCallback(async (time: number) => {
    if (status !== 'RUNNING' || !videoRef.current) return;

    if (videoRef.current.readyState >= 2) {
      renderFrame();

      frameCountRef.current++;
      if (frameCountRef.current % 3 === 0 && !isModelLoading && faceDetectorRef.current) {
        const startTime = performance.now();
        try {
          const nowMs = performance.now();
          const results = faceDetectorRef.current.detectForVideo(videoRef.current, nowMs);
          const boxes = results.detections.map(d => {
            const bbox = d.boundingBox!;
            return {
              originX: bbox.originX,
              originY: bbox.originY,
              width: bbox.width,
              height: bbox.height
            };
          });
          lastDetectionsRef.current = boxes;
          setDetectionsCount(boxes.length);
        } catch (e) {
          console.error("Detection error:", e);
        }
        const endTime = performance.now();
        setCpuUsage(Math.min(100, Math.round((endTime - startTime) * 2)));
      }
    }

    if (time - lastTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastTimeRef.current = time;
    }

    requestRef.current = requestAnimationFrame(processFrame);
  }, [status, renderFrame, isModelLoading]);

  useEffect(() => {
    if (status === 'RUNNING') {
      requestRef.current = requestAnimationFrame(processFrame);
    } else if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [status, processFrame]);

  const sendMessage = (type: 'START' | 'STOP') => {
    browser.runtime.sendMessage({ type }, (response: any) => {
      if (response && response.status) {
        setStatus(response.status === 'RUNNING' ? 'RUNNING' : 'INACTIVE');
      }
    });
  };

  const startProtection = async () => {
    console.log("Starting protection...");
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 }
      });
      console.log("Media stream obtained:", mediaStream);
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await new Promise<void>((resolve, reject) => {
          const video = videoRef.current!;
          video.onloadedmetadata = () => {
            console.log("Video metadata loaded, dimensions:", video.videoWidth, "x", video.videoHeight);
            video.play().then(() => {
              console.log("Video playing, readyState:", video.readyState);
              resolve();
            }).catch(reject);
          };
          video.onerror = () => reject(new Error('Video element error'));
        });
      }
      sendMessage('START');
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Failed to access camera. Please check permissions.");
    }
  };

  const stopProtection = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    sendMessage('STOP');
    setFps(0);
    setCpuUsage(0);
    setDetectionsCount(0);
  };

  const downloadCSV = () => {
    if (sessionLog.length === 0) {
      return;
    }
    const headers = ["Timestamp", "FPS", "CPU Usage (%)", "Faces Detected", "PII Detected", "PII Types"];
    const csvContent = [
      headers.join(","),
      ...sessionLog.map(entry => [
        entry.timestamp,
        entry.fps,
        entry.cpuUsage,
        entry.facesCount,
        entry.piiCount,
        `"${entry.piiLabels}"`
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `shield_session_log_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearLog = () => {
    setSessionLog([]);
  };

  return (
    <div className="w-[400px] h-[600px] bg-[#0A0A0B] text-[#E4E4E7] font-sans selection:bg-orange-500/30 flex flex-col overflow-hidden">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md z-50 shrink-0">
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${status === 'RUNNING' ? 'bg-orange-500/20 text-orange-500' : 'bg-white/5 text-white/40'}`}>
              <Shield size={18} />
            </div>
            <h1 className="font-semibold tracking-tight text-xs uppercase">Edge-AI <span className="text-orange-500">Shield</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 border border-white/10">
              <div className={`w-1.5 h-1.5 rounded-full ${status === 'RUNNING' ? 'bg-green-500 animate-pulse' : 'bg-white/20'}`} />
              <span className="text-[9px] font-mono uppercase tracking-wider opacity-60">
                {status === 'RUNNING' ? 'Active' : 'Standby'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col items-center justify-center">
            <Activity size={12} className="text-orange-500 mb-1" />
            <span className="text-[10px] font-mono text-white/40 uppercase">FPS</span>
            <span className="text-sm font-bold">{fps}</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col items-center justify-center">
            <Cpu size={12} className="text-blue-500 mb-1" />
            <span className="text-[10px] font-mono text-white/40 uppercase">CPU</span>
            <span className="text-sm font-bold">{cpuUsage}%</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col items-center justify-center">
            <Zap size={12} className="text-yellow-500 mb-1" />
            <span className="text-[10px] font-mono text-white/40 uppercase">Objects</span>
            <span className="text-sm font-bold">{totalObjects}</span>
          </div>
        </div>

        <section className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl shrink-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            width={640}
            height={480}
            className="absolute opacity-0 pointer-events-none"
          />
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            className="w-full h-full object-cover"
          />

          {status === 'INACTIVE' && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#111113]/80 backdrop-blur-sm text-white/20 animate-fade-in"
            >
              <ShieldOff size={40} strokeWidth={1} />
              <p className="mt-3 text-[10px] uppercase tracking-[0.2em] font-medium">Protection Offline</p>
            </div>
          )}
          {status === 'RUNNING' && isScanningText && (
            <div
              className="absolute top-4 right-4 bg-red-500/90 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-red-400/50 shadow-lg shadow-red-500/20 animate-slide-up"
            >
              <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">AI Scanning Text...</span>
            </div>
          )}
          {status === 'RUNNING' && blurText && sensitiveRegions.length > 0 && (
            <div
              className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/10 animate-scale-in"
            >
              <Lock size={12} className="text-red-500" />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">
                {sensitiveRegions.length} PII Regions Protected
              </span>
            </div>
          )}

          {status === 'RUNNING' && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="w-full h-[1px] bg-orange-500/30 absolute top-0 animate-[scan_3s_linear_infinite]" />
              <div className="absolute top-2 left-2">
                <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/10">
                  <div className="w-1 h-1 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-[8px] font-mono uppercase tracking-widest">Edge Processing</span>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={startProtection}
              disabled={status === 'RUNNING'}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs transition-all ${status === 'RUNNING'
                ? 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
                : 'bg-orange-500 text-black hover:bg-orange-400 active:scale-95 shadow-[0_0_15px_rgba(249,115,22,0.2)]'
                }`}
            >
              <Power size={16} />
              START
            </button>
            <button
              onClick={stopProtection}
              disabled={status === 'INACTIVE'}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs transition-all ${status === 'INACTIVE'
                ? 'bg-white/5 text-white/20 cursor-not-allowed border border-white/5'
                : 'bg-white/10 text-white hover:bg-white/20 active:scale-95 border border-white/10'
                }`}
            >
              <ShieldOff size={16} />
              STOP
            </button>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${blurFaces ? 'bg-orange-500/10 text-orange-500' : 'bg-white/5 text-white/40'}`}>
                  {blurFaces ? <EyeOff size={16} /> : <Eye size={16} />}
                </div>
                <div>
                  <h3 className="text-xs font-medium">Face Anonymization</h3>
                  <p className="text-[9px] text-white/40">Real-time dynamic blurring</p>
                </div>
              </div>
              <button
                onClick={() => setBlurFaces(!blurFaces)}
                className={`w-9 h-4.5 rounded-full transition-colors relative ${blurFaces ? 'bg-orange-500' : 'bg-white/10'}`}
              >
                <div
                  className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all duration-200 ${blurFaces ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>

            <div className="h-[1px] bg-white/5" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${blurText ? 'bg-orange-500/10 text-orange-500' : 'bg-white/5 text-white/40'}`}>
                  <AlertCircle size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-medium">Sensitive Data Shield</h3>
                  <p className="text-[9px] text-white/40">Credit cards & PII detection</p>
                </div>
              </div>
              <button
                onClick={() => setBlurText(!blurText)}
                className={`w-9 h-4.5 rounded-full transition-colors relative ${blurText ? 'bg-orange-500' : 'bg-white/10'}`}
              >
                <div
                  className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all duration-200 ${blurText ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                  <Activity size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-medium">Session Log</h3>
                  <p className="text-[9px] text-white/40">{sessionLog.length} data points recorded</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={clearLog}
                  disabled={sessionLog.length === 0}
                  className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Clear Log"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={downloadCSV}
                  disabled={sessionLog.length === 0}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[10px] font-bold hover:bg-blue-400 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                  EXPORT CSV
                </button>
              </div>
            </div>
          </div>
        </section>

        <footer className="pt-2 text-center pb-2">
          <p className="text-[8px] text-white/20 font-mono tracking-[0.2em] uppercase">
            Edge-AI Engine // Optimized for Chrome
          </p>
        </footer>
      </main>

      <style>{`
        @keyframes scan {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
