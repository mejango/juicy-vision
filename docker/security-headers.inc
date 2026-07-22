add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

# Do not add X-Frame-Options here: Juicy Vision intentionally supports the Safe
# Apps iframe. Frame policy belongs in a reviewed CSP once all Safe origins are
# explicitly inventoried.
