// Give the service worker access to Firebase Messaging.
// Note that you can only use Firebase Messaging here.
importScripts(
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js"
);

// Initialize the Firebase app in the service worker by passing in
// your app's Firebase config object.
firebase.initializeApp({
  apiKey: "AIzaSyCjJzQGCZ0niMD5tek_0gLSBGJXxW0VLKA",
  authDomain: "channelchat-7d679.firebaseapp.com",
  projectId: "channelchat-7d679",
  storageBucket: "channelchat-7d679.appspot.com",
  messagingSenderId: "822894243205",
  appId: "1:822894243205:web:8c8b1648fece9ae33e68ec",
});

// Retrieve an instance of Firebase Messaging so that it can handle background
// messages.
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Received background message ",
    payload
  );

  // Customize notification here
  const notificationTitle = payload.notification?.title || "New Message";
  const notificationOptions = {
    body: payload.notification?.body || "",
    icon: "/icons/app-icon-192.png",
    badge: "/icons/badge-icon-96.png",
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Handle the notification click
  // This assumes the data contains a contactId
  const contactId = event.notification.data?.contactId;

  if (contactId) {
    // If we have a contactId, we can use it to open the conversation

    // Check if the app is already open
    event.waitUntil(
      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true,
        })
        .then((clientList) => {
          // If the app is already open, focus it
          for (const client of clientList) {
            if (
              client.url.includes(self.location.origin) &&
              "focus" in client
            ) {
              // If we find a window, focus it and post a message to navigate
              client.focus();
              client.postMessage({
                type: "NOTIFICATION_CLICK",
                contactId: contactId,
              });
              return;
            }
          }

          // If the app is not open, open it
          if (clients.openWindow) {
            // Open the app and add the contactId as a query parameter
            clients.openWindow(`${self.location.origin}/chat/${contactId}`);
          }
        })
    );
  } else {
    // If we don't have a contactId, just open the app
    event.waitUntil(
      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true,
        })
        .then((clientList) => {
          // If the app is already open, focus it
          for (const client of clientList) {
            if (
              client.url.includes(self.location.origin) &&
              "focus" in client
            ) {
              client.focus();
              return;
            }
          }

          // If the app is not open, open it
          if (clients.openWindow) {
            clients.openWindow(self.location.origin);
          }
        })
    );
  }
});
