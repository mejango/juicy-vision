/**
 * QR Code Component
 *
 * Generates and displays a QR code for payment URL.
 */

import { useEffect, useState } from 'react'
import QRCodeLib from 'qrcode'

interface QRCodeProps {
  value: string
  size?: number
}

export default function QRCode({ value, size = 200 }: QRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    QRCodeLib.toDataURL(value, {
      width: size,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then(setDataUrl)
      .catch((err) => setError(err.message))
  }, [value, size])

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-white/10 text-gray-400 text-sm"
        style={{ width: size, height: size }}
      >
        QR Error
      </div>
    )
  }

  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center bg-white/10"
        style={{ width: size, height: size }}
      >
        <div className="w-6 h-6 border-2 border-juice-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="qr-container">
      <img src={dataUrl} alt="Payment QR Code" width={size} height={size} />
    </div>
  )
}
