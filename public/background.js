let status = 'INACTIVE';

// Persist stats in memory for the current session
let sessionStats = {
  totalFaces: 0,
  totalPII: 0,
  startTime: Date.now()
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START') {
    status = 'RUNNING';
    sessionStats.startTime = Date.now();
    sendResponse({ status: 'RUNNING' });
  } else if (message.type === 'STOP') {
    status = 'INACTIVE';
    sendResponse({ status: 'INACTIVE' });
  } else if (message.type === 'GET_STATUS') {
    sendResponse({ status, stats: sessionStats });
  } else if (message.type === 'LOG_DETECTION') {
    const { faces, pii } = message;
    sessionStats.totalFaces += faces;
    sessionStats.totalPII += (pii || []).length;

    // Save to historical logs in local storage
    chrome.storage.local.get(['history'], (result) => {
      const history = result.history || [];
      const newEntry = {
        timestamp: new Date().toISOString(),
        faces,
        piiCount: (pii || []).length,
        labels: (pii || []).map(p => p.label)
      };

      const updatedHistory = [newEntry, ...history].slice(0, 1000); // Keep last 1000 detections
      chrome.storage.local.set({
        history: updatedHistory,
        stats: sessionStats
      });
    });
  }
  return true;
});
