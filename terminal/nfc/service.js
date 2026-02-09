/**
 * PayTerm NFC Service
 *
 * Handles NFC communication with PN532 module.
 * Writes payment URLs to Android phones via NDEF.
 *
 * Note: iOS doesn't support Web NFC writing, so iOS users
 * must scan the QR code displayed on screen.
 */

const { spawn } = require('child_process')
const EventEmitter = require('events')

class NFCService extends EventEmitter {
  constructor() {
    super()
    this.isRunning = false
    this.currentUrl = null
    this.process = null
  }

  /**
   * Start the NFC service
   */
  start() {
    if (this.isRunning) return

    this.isRunning = true
    console.log('[NFC] Service started')

    // Poll for NFC tags
    this.poll()
  }

  /**
   * Stop the NFC service
   */
  stop() {
    this.isRunning = false
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    console.log('[NFC] Service stopped')
  }

  /**
   * Set the URL to write to NFC tags
   */
  setPaymentUrl(url) {
    this.currentUrl = url
    console.log('[NFC] Payment URL set:', url)
  }

  /**
   * Clear the current payment URL
   */
  clearPaymentUrl() {
    this.currentUrl = null
    console.log('[NFC] Payment URL cleared')
  }

  /**
   * Poll for NFC tags and write NDEF URL
   */
  poll() {
    if (!this.isRunning) return

    // Use nfc-mfultralight or custom NDEF writer
    // This is a simplified example - real implementation would use
    // the libnfc library directly or a Node.js NFC binding

    // Check if nfc-poll is available
    this.process = spawn('nfc-poll', ['-q'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout.on('data', (data) => {
      const output = data.toString()
      console.log('[NFC] Tag detected:', output)

      if (this.currentUrl) {
        this.writeNdefUrl(this.currentUrl)
      }
    })

    this.process.stderr.on('data', (data) => {
      // Ignore timeout errors
      const err = data.toString()
      if (!err.includes('timeout')) {
        console.error('[NFC] Error:', err)
      }
    })

    this.process.on('close', (code) => {
      // Restart polling after a short delay
      if (this.isRunning) {
        setTimeout(() => this.poll(), 500)
      }
    })

    this.process.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('[NFC] nfc-poll not found. NFC features disabled.')
        this.isRunning = false
        return
      }
      console.error('[NFC] Process error:', err)
      // Retry after delay
      if (this.isRunning) {
        setTimeout(() => this.poll(), 2000)
      }
    })
  }

  /**
   * Write NDEF URL record to tag
   */
  writeNdefUrl(url) {
    console.log('[NFC] Writing URL to tag:', url)

    // Use nfc-mfultralight to write NDEF
    // This is a simplified example
    const ndefMessage = this.createNdefUrlRecord(url)

    const writeProcess = spawn('nfc-mfultralight', ['w', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    writeProcess.stdin.write(ndefMessage)
    writeProcess.stdin.end()

    writeProcess.on('close', (code) => {
      if (code === 0) {
        console.log('[NFC] URL written successfully')
        this.emit('write-success', url)
      } else {
        console.error('[NFC] Write failed with code:', code)
        this.emit('write-error', new Error('Write failed'))
      }
    })
  }

  /**
   * Create NDEF URL record bytes
   */
  createNdefUrlRecord(url) {
    // NDEF URL record format:
    // - Header byte (0xD1 = MB, ME, SR, TNF=1 Well-Known)
    // - Type length (0x01)
    // - Payload length (variable)
    // - Type ("U" for URI)
    // - Payload (URL prefix byte + URL)

    // URL prefix codes
    const prefixes = {
      'http://www.': 0x01,
      'https://www.': 0x02,
      'http://': 0x03,
      'https://': 0x04,
    }

    let prefix = 0x00 // No prefix
    let urlData = url

    for (const [p, code] of Object.entries(prefixes)) {
      if (url.startsWith(p)) {
        prefix = code
        urlData = url.slice(p.length)
        break
      }
    }

    const payload = Buffer.concat([
      Buffer.from([prefix]),
      Buffer.from(urlData, 'utf8'),
    ])

    const record = Buffer.concat([
      Buffer.from([0xD1]), // Header: MB=1, ME=1, SR=1, TNF=1
      Buffer.from([0x01]), // Type length
      Buffer.from([payload.length]), // Payload length (short record)
      Buffer.from('U', 'ascii'), // Type: URI
      payload,
    ])

    // Wrap in NDEF TLV for Mifare Ultralight
    const tlv = Buffer.concat([
      Buffer.from([0x03]), // NDEF Message TLV tag
      Buffer.from([record.length]), // Length
      record,
      Buffer.from([0xFE]), // Terminator TLV
    ])

    return tlv
  }
}

// Export singleton instance
module.exports = new NFCService()

// If run directly, start the service
if (require.main === module) {
  const service = module.exports
  service.start()

  // For testing, set a demo URL
  service.setPaymentUrl('https://pay.juicyvision.app/s/demo')

  process.on('SIGINT', () => {
    service.stop()
    process.exit()
  })
}
