chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(error => console.error('Gagal mengaktifkan panel samping', error));

importScripts('myjd.js', 'jd-dialogs.js', 'start-job.js', 'jd-account.js');

// Keep a submitted job running when the user closes the side panel.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  let request;
  if (sender.url === chrome.runtime.getURL('viewer.html') && message.action === 'viewer-start') {
    request = startViewerSelection(message.ids, message.target);
  } else if (sender.url !== chrome.runtime.getURL('panel.html')) return;
  else if (message.action === 'jd-send') request = JDAccount.send(message.urls, message.autostart, message.expected, message.destinationFolder);
  else if (message.action === 'jd-resume-job') request = JDAccount.resumeJob(message.jobId, message.target);
  else if (message.action === 'jd-start-link') request = JDAccount.startLink(message.uuid, message.target);
  else return;
  request.then(
    result => respond({ok: true, result}),
    error => respond({ok: false, message: error.message, code: error.code})
  );
  return true;
});
