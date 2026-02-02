import { useState, useCallback } from 'react'
import { parseEther, formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import type { JB721TierConfigInput } from '../../services/tiersHook'
import type { JB721HookFlags, TierPermissions } from '../../services/nft'
import { validateTierChange } from '../../services/nft'
import { encodeIpfsUri, pinJson, pinFile } from '../../utils/ipfs'
import { ZERO_ADDRESS } from '../../constants'

interface TierEditorProps {
  /** Tier data for editing, undefined for new tier */
  existingTier?: Partial<JB721TierConfigInput> & {
    tierId?: number
    name?: string
    description?: string
    imageUri?: string
    discountPercent?: number
    permissions?: TierPermissions
  }
  /** Hook flags to validate against */
  hookFlags: JB721HookFlags
  /** Called when tier is saved */
  onSave: (tier: JB721TierConfigInput, metadata: TierMetadata) => void
  /** Called to cancel editing */
  onCancel: () => void
  /** Pinata JWT for IPFS uploads (optional - disables image upload if not provided) */
  pinataJwt?: string
  /** Currency label (ETH or USDC) */
  currencyLabel?: string
}

/** Metadata that will be pinned to IPFS */
export interface TierMetadata {
  name: string
  description?: string
  image?: string
}

interface TierFormState {
  name: string
  description: string
  imageUri: string
  price: string
  initialSupply: string
  votingUnits: string
  reserveFrequency: string
  reserveBeneficiary: string
  category: string
  discountPercent: string
  allowOwnerMint: boolean
  transfersPausable: boolean
  cannotBeRemoved: boolean
  cannotIncreaseDiscountPercent: boolean
}

export default function TierEditor({
  existingTier,
  hookFlags,
  onSave,
  onCancel,
  pinataJwt,
  currencyLabel = 'ETH',
}: TierEditorProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const isEditing = !!existingTier?.tierId

  // Form state
  const [formState, setFormState] = useState<TierFormState>({
    name: existingTier?.name || '',
    description: existingTier?.description || '',
    imageUri: existingTier?.imageUri || '',
    price: existingTier?.price ? formatEther(BigInt(existingTier.price)) : '0.01',
    initialSupply: existingTier?.initialSupply?.toString() || '100',
    votingUnits: existingTier?.votingUnits?.toString() || '0',
    reserveFrequency: existingTier?.reserveFrequency?.toString() || '0',
    reserveBeneficiary: existingTier?.reserveBeneficiary || ZERO_ADDRESS,
    category: existingTier?.category?.toString() || '0',
    discountPercent: existingTier?.discountPercent?.toString() || '0',
    allowOwnerMint: existingTier?.allowOwnerMint || false,
    transfersPausable: existingTier?.transfersPausable || false,
    cannotBeRemoved: existingTier?.cannotBeRemoved || false,
    cannotIncreaseDiscountPercent: existingTier?.cannotIncreaseDiscountPercent || false,
  })

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Update form state
  const updateField = useCallback(<K extends keyof TierFormState>(
    key: K,
    value: TierFormState[K]
  ) => {
    setFormState(prev => ({ ...prev, [key]: value }))
    setValidationError(null)
  }, [])

  // Handle image upload
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pinataJwt) return

    setUploading(true)
    setError(null)

    try {
      const cid = await pinFile(file, pinataJwt, `tier-${formState.name || 'image'}`)
      updateField('imageUri', `ipfs://${cid}`)
    } catch (err) {
      console.error('Failed to upload image:', err)
      setError('Failed to upload image. Please try again.')
    } finally {
      setUploading(false)
    }
  }, [pinataJwt, formState.name, updateField])

  // Validate and save
  const handleSave = useCallback(async () => {
    // Basic validation
    if (!formState.name.trim()) {
      setValidationError('Tier name is required')
      return
    }

    const price = parseEther(formState.price || '0')
    const initialSupply = parseInt(formState.initialSupply) || 0
    const votingUnits = parseInt(formState.votingUnits) || 0
    const reserveFrequency = parseInt(formState.reserveFrequency) || 0

    if (initialSupply <= 0) {
      setValidationError('Supply must be greater than 0')
      return
    }

    // Build tier config
    const tierConfig: JB721TierConfigInput = {
      price: price.toString(),
      initialSupply,
      votingUnits,
      reserveFrequency,
      reserveBeneficiary: (formState.reserveBeneficiary || ZERO_ADDRESS) as string,
      encodedIPFSUri: '0x0000000000000000000000000000000000000000000000000000000000000000', // Will be set after pinning
      category: parseInt(formState.category) || 0,
      discountPercent: parseInt(formState.discountPercent) || 0,
      allowOwnerMint: formState.allowOwnerMint,
      useReserveBeneficiaryAsDefault: !!formState.reserveBeneficiary && formState.reserveBeneficiary !== ZERO_ADDRESS,
      transfersPausable: formState.transfersPausable,
      useVotingUnits: votingUnits > 0,
      cannotBeRemoved: formState.cannotBeRemoved,
      cannotIncreaseDiscountPercent: formState.cannotIncreaseDiscountPercent,
    }

    // Validate against hook flags
    const validation = validateTierChange(tierConfig, hookFlags, existingTier?.permissions)
    if (!validation.allowed) {
      setValidationError(validation.blockedReason || 'This tier configuration is not allowed')
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Build metadata
      const metadata: TierMetadata = {
        name: formState.name.trim(),
        description: formState.description.trim() || undefined,
        image: formState.imageUri || undefined,
      }

      // If we have Pinata JWT, pin the metadata
      if (pinataJwt) {
        const metadataCid = await pinJson(metadata, pinataJwt, `tier-metadata-${metadata.name}`)
        const encodedUri = encodeIpfsUri(metadataCid)
        if (encodedUri) {
          tierConfig.encodedIPFSUri = encodedUri
        }
      }

      onSave(tierConfig, metadata)
    } catch (err) {
      console.error('Failed to save tier:', err)
      setError('Failed to save tier. Please try again.')
    } finally {
      setSaving(false)
    }
  }, [formState, hookFlags, existingTier, pinataJwt, onSave])

  return (
    <div className={`border ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-600' : 'border-gray-200'}`}>
        <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {isEditing ? `Edit Tier #${existingTier?.tierId}` : 'Add New Tier'}
        </h3>
      </div>

      <div className="p-4 space-y-4">
        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Name *
            </label>
            <input
              type="text"
              value={formState.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Tier name"
              className={`w-full px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
          </div>

          <div className="col-span-2">
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Description
            </label>
            <textarea
              value={formState.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Describe what holders get..."
              rows={2}
              className={`w-full px-3 py-2 text-sm outline-none resize-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
          </div>
        </div>

        {/* Image */}
        <div>
          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Image
          </label>
          <div className="flex gap-3">
            {formState.imageUri && (
              <div className={`w-16 h-16 flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                <img
                  src={formState.imageUri.startsWith('ipfs://')
                    ? `https://gateway.pinata.cloud/ipfs/${formState.imageUri.slice(7)}`
                    : formState.imageUri}
                  alt="Tier preview"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex-1">
              <input
                type="text"
                value={formState.imageUri}
                onChange={(e) => updateField('imageUri', e.target.value)}
                placeholder="ipfs://... or https://..."
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
              {pinataJwt && (
                <label className={`block mt-2 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <span className={`text-xs cursor-pointer ${
                    isDark ? 'text-juice-orange hover:text-juice-orange/80' : 'text-orange-600 hover:text-orange-700'
                  }`}>
                    {uploading ? 'Uploading...' : 'Or upload image'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Price & Supply */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Price ({currencyLabel})
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={formState.price}
              onChange={(e) => updateField('price', e.target.value)}
              placeholder="0.01"
              className={`w-full px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
          </div>

          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Supply
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={formState.initialSupply}
              onChange={(e) => updateField('initialSupply', e.target.value)}
              placeholder="100"
              className={`w-full px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Category
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={formState.category}
            onChange={(e) => updateField('category', e.target.value)}
            placeholder="0"
            className={`w-full px-3 py-2 text-sm outline-none ${
              isDark
                ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
          <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Group tiers by category for filtering
          </span>
        </div>

        {/* Advanced Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`w-full py-2 text-xs font-medium transition-colors ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {showAdvanced ? 'Hide' : 'Show'} Advanced Options
        </button>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className={`p-3 space-y-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            {/* Voting & Reserves */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Voting Units
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formState.votingUnits}
                  onChange={(e) => updateField('votingUnits', e.target.value)}
                  placeholder="0"
                  disabled={hookFlags.noNewTiersWithVotes && !isEditing}
                  className={`w-full px-3 py-2 text-sm outline-none ${
                    isDark
                      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  } ${hookFlags.noNewTiersWithVotes && !isEditing ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                {hookFlags.noNewTiersWithVotes && !isEditing && (
                  <span className={`text-[10px] ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                    Disabled by collection settings
                  </span>
                )}
              </div>

              <div>
                <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Reserve Frequency
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formState.reserveFrequency}
                  onChange={(e) => updateField('reserveFrequency', e.target.value)}
                  placeholder="0"
                  disabled={hookFlags.noNewTiersWithReserves && !isEditing}
                  className={`w-full px-3 py-2 text-sm outline-none ${
                    isDark
                      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  } ${hookFlags.noNewTiersWithReserves && !isEditing ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                {hookFlags.noNewTiersWithReserves && !isEditing && (
                  <span className={`text-[10px] ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                    Disabled by collection settings
                  </span>
                )}
              </div>
            </div>

            {/* Reserve Beneficiary */}
            {parseInt(formState.reserveFrequency) > 0 && (
              <div>
                <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Reserve Beneficiary
                </label>
                <input
                  type="text"
                  value={formState.reserveBeneficiary}
                  onChange={(e) => updateField('reserveBeneficiary', e.target.value)}
                  placeholder="0x..."
                  className={`w-full px-3 py-2 text-sm font-mono outline-none ${
                    isDark
                      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
              </div>
            )}

            {/* Discount */}
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Discount Percent
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={formState.discountPercent}
                onChange={(e) => updateField('discountPercent', e.target.value)}
                placeholder="0"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                % discount on tier price
              </span>
            </div>

            {/* Boolean Flags */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.allowOwnerMint}
                  onChange={(e) => updateField('allowOwnerMint', e.target.checked)}
                  disabled={hookFlags.noNewTiersWithOwnerMinting && !isEditing}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${
                  isDark ? 'text-gray-300' : 'text-gray-600'
                } ${hookFlags.noNewTiersWithOwnerMinting && !isEditing ? 'opacity-50' : ''}`}>
                  Allow owner minting
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.transfersPausable}
                  onChange={(e) => updateField('transfersPausable', e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  Transfers pausable
                </span>
              </label>

              {!isEditing && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.cannotBeRemoved}
                      onChange={(e) => updateField('cannotBeRemoved', e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Cannot be removed (permanent)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.cannotIncreaseDiscountPercent}
                      onChange={(e) => updateField('cannotIncreaseDiscountPercent', e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Cannot increase discount
                    </span>
                  </label>
                </>
              )}
            </div>
          </div>
        )}

        {/* Validation/Error Messages */}
        {(validationError || error) && (
          <div className={`p-3 text-sm ${
            isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'
          }`}>
            {validationError || error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              isDark
                ? 'bg-white/10 text-white hover:bg-white/20'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              saving || uploading
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
            }`}
          >
            {saving ? 'Saving...' : isEditing ? 'Update Tier' : 'Add Tier'}
          </button>
        </div>
      </div>
    </div>
  )
}
