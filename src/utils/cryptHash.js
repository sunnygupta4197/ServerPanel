// SHA-512-crypt (glibc crypt(3) format, `$6$...`) password hashing via
// `openssl passwd -6 -stdin` — spawned with the password piped over stdin,
// never passed as an argv element, so it never appears in a process list.
// Originally written for vsftpd/PAM's pam_userdb (see ftpService.js);
// Dovecot's passdb also accepts this exact format (as {SHA512-CRYPT}), so
// mailService.js reuses it rather than duplicating the same spawn logic.
const { spawn } = require('child_process');

function generateCryptHash(password) {
  return new Promise((resolve, reject) => {
    const child = spawn('openssl', ['passwd', '-6', '-stdin']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`openssl exited ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(password);
    child.stdin.end();
  });
}

module.exports = { generateCryptHash };
