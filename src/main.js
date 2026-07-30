import { Sender } from './sender';
import { Receiver } from './receiver';

document.addEventListener('DOMContentLoaded', () => {
  const sender = new Sender();
  const receiver = new Receiver();

  // Tab switching logic
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');

      // Update tab active classes
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update pane active classes
      panes.forEach(pane => {
        if (pane.id === targetId) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });

      // Handle stream lifecycles during tab changes
      if (targetId === 'receive-pane') {
        // Stop sender animations if moving to receiver
        sender.pause();
        
        // Auto-start camera when switching to receiver (if not finished)
        if (!receiver.isFinished && !receiver.stream) {
          receiver.startCamera();
        }
      } else {
        // Stop receiver camera when moving away
        receiver.stopCamera();
      }
    });
  });
});
