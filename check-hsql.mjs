import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

try {
  console.log('Navigating to app...');
  
  // Intercept API responses
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/sessions')) {
      console.log('API Response from:', url);
      try {
        const data = await response.json();
        console.log('Sessions count:', data.sessions?.length || 0);
        if (data.sessions) {
          for (const session of data.sessions) {
            console.log('Session:', session.projectName, '-', session.realTimeStatus);
            if (session.projectName?.toLowerCase().includes('hsql')) {
              console.log('\n=== HSQL SESSION FOUND ===');
              console.log(JSON.stringify(session, null, 2));
            }
          }
        }
      } catch (e) {
        console.log('Could not parse response as JSON');
      }
    }
  });
  
  await page.goto('http://127.0.0.1:3456', { timeout: 15000 });
  
  // Wait for potential data load
  console.log('Waiting 20 seconds for API responses...');
  await page.waitForTimeout(20000);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/app-final.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/app-final.png');
  
  // Check console logs
  const logs = await page.evaluate(() => {
    // Access localStorage
    const snapshot = localStorage.getItem('vibepulse:last-sessions-snapshot');
    return { snapshot };
  });
  
  if (logs.snapshot) {
    const snapshot = JSON.parse(logs.snapshot);
    console.log('\nCached snapshot found:', snapshot.sessions?.length || 0, 'sessions');
    for (const session of snapshot.sessions || []) {
      if (session.projectName?.toLowerCase().includes('hsql')) {
        console.log('\n=== CACHED HSQL SESSION ===');
        console.log('Status:', session.status);
        console.log('WaitingForUser:', session.waitingForUser);
        console.log('Children:', session.children?.length || 0);
        for (const child of session.children || []) {
          console.log('  Child:', child.title, '-', child.realTimeStatus);
        }
      }
    }
  } else {
    console.log('\nNo cached snapshot found');
  }
  
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await browser.close();
}
