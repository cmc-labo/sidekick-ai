// Open side panel when the toolbar icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// Open side panel via keyboard shortcut (Ctrl+Shift+S / Cmd+Shift+S)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-sidepanel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  }
});
