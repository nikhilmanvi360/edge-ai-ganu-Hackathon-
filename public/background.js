let status = 'INACTIVE';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START') {
    status = 'RUNNING';
    sendResponse({ status: 'RUNNING' });
  } else if (message.type === 'STOP') {
    status = 'INACTIVE';
    sendResponse({ status: 'INACTIVE' });
  } else if (message.type === 'GET_STATUS') {
    sendResponse({ status });
  }
  return true; // Keep message channel open for async response
});
