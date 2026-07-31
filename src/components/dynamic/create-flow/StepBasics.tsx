/**
 * Create-flow Step 1: Basics — a 1:1 port of the website's renderDetails
 * (website/src/create-flow.js). Copy comes verbatim from the source flow.
 */


import { pinFileToBackend } from '../../../services/ipfsPinning'
import type { CreateFlowState } from './state'
import { Collapse, FieldBlock, Hint, ImagePicker, Pill, StepHead, TextArea, TextInput } from './controls'

export const TAG_OPTIONS = ['AI', 'Art', 'Brand', 'Business', 'Charity', 'Climate', 'Collectibles', 'Community',
  'Creator', 'DAO', 'DeFi', 'DeSci', 'Education', 'Events', 'Film', 'Fundraising', 'Games', 'Grants',
  'Hackathon', 'Media', 'Memes', 'Music', 'NFT', 'Open Source', 'Podcast', 'Public Goods', 'Research',
  'Social', 'Software', 'Sports', 'Tooling', 'Writing']

interface StepProps {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
}

export default function StepBasics({ state, update }: StepProps) {
  const d = state.details

  // Standard image pin flow, matching the website's renderImagePicker: set busy
  // while pinning, store the returned ipfs:// uri, revert on failure. Media pins
  // through the backend like project metadata (no browser Pinata key).
  const pinImage = (file: File, apply: (s: CreateFlowState, uri: string, busy: boolean) => void, current: string) => {
    update((s) => apply(s, current, true))
    pinFileToBackend(file, file.name)
      .then((uri) => update((s) => apply(s, uri, false)))
      .catch((e: unknown) => {
        alert('Could not upload: ' + (e instanceof Error ? e.message : String(e)))
        update((s) => apply(s, current, false))
      })
  }

  return (
    <div>
      <StepHead
        desc={`The ${state.projectType === 'revnet' ? 'revnet operator' : 'project owner'} can edit these after launch.`}
      />

      <FieldBlock label="Name">
        <TextInput
          value={d.name}
          placeholder="My project"
          onChange={(v) => update((s) => { s.details.name = v })}
        />
      </FieldBlock>

      {/* Token ticker — revnets only (it names the ERC-20 REVDeployer deploys). A custom
          project's ERC-20 is deployed later from the Owner tab, which asks for the symbol then. */}
      {state.projectType === 'revnet' && (
        <FieldBlock label="Token symbol">
          <TextInput
            value={d.ticker}
            placeholder="TOKEN"
            className="w-1/4 min-w-[120px]"
            onChange={(v) => update((s) => { s.details.ticker = v.trim().toUpperCase().slice(0, 11) })}
          />
        </FieldBlock>
      )}

      <FieldBlock label="Tagline" optional>
        <TextInput
          value={d.tagline}
          placeholder="A brief one-sentence summary of your project."
          onChange={(v) => update((s) => { s.details.tagline = v })}
        />
      </FieldBlock>

      <FieldBlock label="Description" optional>
        <TextArea
          value={d.description}
          placeholder="What is your project about?"
          onChange={(v) => update((s) => { s.details.description = v })}
        />
      </FieldBlock>

      {/* Logo */}
      <FieldBlock label="Logo" optional>
        <ImagePicker
          uri={d.logoUri}
          busy={d.logoUploading}
          onPick={(f) => pinImage(f, (s, uri, busy) => { s.details.logoUri = uri; s.details.logoUploading = busy }, d.logoUri)}
          onClear={() => update((s) => { s.details.logoUri = ''; s.details.logoUploading = false })}
        />
      </FieldBlock>

      {/* Project links */}
      <Collapse
        label="Project links"
        optional
        open={d.linksOpen}
        onToggle={() => update((s) => { s.details.linksOpen = !s.details.linksOpen })}
      >
        <div className="grid grid-cols-2 gap-3">
          <FieldBlock label="Website" optional>
            <TextInput value={d.website} placeholder="https://…" onChange={(v) => update((s) => { s.details.website = v })} />
          </FieldBlock>
          <FieldBlock label="Twitter handle" optional>
            <TextInput value={d.twitter} placeholder="@handle" onChange={(v) => update((s) => { s.details.twitter = v })} />
          </FieldBlock>
          <FieldBlock label="Discord" optional>
            <TextInput value={d.discord} placeholder="https://discord.gg/…" onChange={(v) => update((s) => { s.details.discord = v })} />
          </FieldBlock>
          <FieldBlock label="Telegram" optional>
            <TextInput value={d.telegram} placeholder="https://t.me/…" onChange={(v) => update((s) => { s.details.telegram = v })} />
          </FieldBlock>
          <FieldBlock label="Instagram" optional>
            <TextInput value={d.instagram} placeholder="https://instagram.com/…" onChange={(v) => update((s) => { s.details.instagram = v })} />
          </FieldBlock>
          <FieldBlock label="WhatsApp" optional>
            <TextInput value={d.whatsapp} placeholder="https://wa.me/…" onChange={(v) => update((s) => { s.details.whatsapp = v })} />
          </FieldBlock>
        </div>
      </Collapse>

      {/* Tags */}
      <Collapse
        label="Project tags"
        optional
        open={d.tagsOpen}
        onToggle={() => update((s) => { s.details.tagsOpen = !s.details.tagsOpen })}
      >
        <Hint>Select up to 3 tags to help supporters find your project.</Hint>
        <div className="flex flex-wrap gap-2 mt-3">
          {TAG_OPTIONS.map((tag) => {
            const on = d.tags.includes(tag)
            return (
              <Pill
                key={tag}
                label={tag}
                selected={on}
                onClick={() => update((s) => {
                  if (on) s.details.tags = s.details.tags.filter((x) => x !== tag)
                  else if (s.details.tags.length < 3) s.details.tags.push(tag)
                })}
              />
            )
          })}
        </div>
      </Collapse>

      {/* Page customizations */}
      <Collapse
        label="Project page customizations"
        optional
        open={d.customOpen}
        onToggle={() => update((s) => { s.details.customOpen = !s.details.customOpen })}
      >
        <FieldBlock label="Cover image" optional>
          <ImagePicker
            uri={d.coverImageUri}
            busy={false}
            onPick={(f) => pinImage(f, (s, uri) => { s.details.coverImageUri = uri }, d.coverImageUri)}
            onClear={() => update((s) => { s.details.coverImageUri = '' })}
          />
        </FieldBlock>
        <FieldBlock label="Payment notice" optional>
          <TextArea
            value={d.payDisclosure}
            placeholder="Shown to payers before they pay."
            onChange={(v) => update((s) => { s.details.payDisclosure = v })}
          />
        </FieldBlock>
      </Collapse>
    </div>
  )
}
