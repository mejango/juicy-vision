--
-- PostgreSQL database dump
--

\restrict ZQp1eMK72nDPIc6wL3gF0hR0tOdEtQegTtQtKJsleno5x7Wemg4WG4ILje4cspw

-- Dumped from database version 16.11
-- Dumped by pg_dump version 16.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: chat_member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_member_role AS ENUM (
    'founder',
    'admin',
    'member'
);


--
-- Name: juicy_rating; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.juicy_rating AS ENUM (
    'wow',
    'great',
    'meh',
    'bad'
);


--
-- Name: cleanup_context_usage_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_context_usage_log() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM context_usage_log
  WHERE chat_id = NEW.chat_id
  AND id NOT IN (
    SELECT id FROM context_usage_log
    WHERE chat_id = NEW.chat_id
    ORDER BY created_at DESC
    LIMIT 100
  );
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_billing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_billing (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    amount_wei character varying(78) NOT NULL,
    payer_address character varying(42),
    tx_hash character varying(66),
    project_id integer,
    chain_id integer,
    message_id uuid,
    model character varying(50),
    tokens_used integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_billing_type_check CHECK (((type)::text = ANY ((ARRAY['deposit'::character varying, 'usage'::character varying, 'refund'::character varying])::text[])))
);


--
-- Name: applied_training_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applied_training_suggestions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    training_run_id uuid,
    section character varying(100) NOT NULL,
    priority character varying(20) NOT NULL,
    suggestion_text text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_by character varying(100),
    effectiveness_score numeric(3,2),
    notes text
);


--
-- Name: attachment_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachment_summaries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    attachment_index integer NOT NULL,
    original_filename character varying(255),
    original_mime_type character varying(100),
    original_size_bytes integer,
    summary_md text NOT NULL,
    extracted_data jsonb,
    token_count integer NOT NULL,
    model_used character varying(50),
    generation_latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE attachment_summaries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.attachment_summaries IS 'Persistent summaries of uploaded documents/images. Accessible even after source message falls out of context window.';


--
-- Name: chat_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    actor_id character varying(255),
    target_id character varying(255),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_folders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_address character varying(42) NOT NULL,
    user_id uuid,
    name character varying(255) DEFAULT 'New Folder'::character varying NOT NULL,
    parent_folder_id uuid,
    is_pinned boolean DEFAULT false NOT NULL,
    pin_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    code character varying(32) NOT NULL,
    created_by character varying(255) NOT NULL,
    can_send_messages boolean DEFAULT true NOT NULL,
    can_invite_others boolean DEFAULT false NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    uses integer DEFAULT 0 NOT NULL,
    max_uses integer,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    can_pass_on_roles boolean DEFAULT false NOT NULL,
    can_invoke_ai boolean DEFAULT true NOT NULL,
    can_pause_ai boolean DEFAULT false NOT NULL,
    can_grant_pause_ai boolean DEFAULT false NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    tool_calls jsonb,
    feedback_helpful boolean,
    feedback_reported boolean DEFAULT false,
    feedback_report_reason text,
    feedback_user_correction text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: chat_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    reporter_address text NOT NULL,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chat_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text, 'actioned'::text])))
);


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    privacy_mode character varying(20) DEFAULT 'open_book'::character varying NOT NULL,
    wallet_connected boolean DEFAULT false NOT NULL,
    mode character varying(20) DEFAULT 'self_custody'::character varying NOT NULL,
    entry_point character varying(255),
    outcome_completed_payment boolean DEFAULT false,
    outcome_found_project boolean DEFAULT false,
    outcome_connected_wallet boolean DEFAULT false,
    outcome_error_encountered boolean DEFAULT false,
    outcome_user_abandoned boolean DEFAULT false,
    session_rating integer,
    session_feedback text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT chat_sessions_mode_check CHECK (((mode)::text = ANY ((ARRAY['self_custody'::character varying, 'managed'::character varying])::text[]))),
    CONSTRAINT chat_sessions_session_rating_check CHECK (((session_rating >= 1) AND (session_rating <= 5)))
);


--
-- Name: chat_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_summaries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    summary_md text NOT NULL,
    covers_from_message_id uuid,
    covers_to_message_id uuid,
    covers_from_created_at timestamp with time zone,
    covers_to_created_at timestamp with time zone,
    message_count integer NOT NULL,
    original_token_count integer NOT NULL,
    summary_token_count integer NOT NULL,
    compression_ratio numeric(5,2) GENERATED ALWAYS AS (
CASE
    WHEN (summary_token_count > 0) THEN ((original_token_count)::numeric / (summary_token_count)::numeric)
    ELSE (0)::numeric
END) STORED,
    model_used character varying(50),
    generation_latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE chat_summaries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.chat_summaries IS 'Anchored iterative summaries. New summaries are merged with existing rather than regenerated from scratch.';


--
-- Name: chat_transaction_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_transaction_state (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    last_updated_by_message_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE chat_transaction_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.chat_transaction_state IS 'Entity memory for chat sessions. Preserves project design decisions and user preferences even when messages are summarized.';


--
-- Name: context_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_usage_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    message_id uuid,
    total_tokens integer NOT NULL,
    system_prompt_tokens integer,
    transaction_state_tokens integer,
    user_context_tokens integer,
    summary_tokens integer,
    recent_message_tokens integer,
    attachment_summary_tokens integer,
    recent_message_count integer,
    summary_count integer,
    attachment_count integer,
    budget_exceeded boolean DEFAULT false,
    triggered_summarization boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE context_usage_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.context_usage_log IS 'Analytics for tuning token budgets. Tracks what was included in each AI invocation.';


--
-- Name: corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corrections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    session_id uuid NOT NULL,
    original_content text NOT NULL,
    user_correction text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    review_notes text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT corrections_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: created_project_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.created_project_chains (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    created_project_id uuid NOT NULL,
    chain_id integer NOT NULL,
    project_id integer,
    tx_hash character varying(66),
    tx_uuid character varying(66),
    status character varying(20) DEFAULT 'pending'::character varying,
    error_message text,
    gas_used character varying(78),
    gas_price character varying(78),
    sucker_address character varying(42),
    sucker_tx_hash character varying(66),
    sucker_status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT created_project_chains_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'submitted'::character varying, 'confirmed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT created_project_chains_sucker_status_check CHECK (((sucker_status)::text = ANY ((ARRAY['pending'::character varying, 'submitted'::character varying, 'confirmed'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])))
);


--
-- Name: TABLE created_project_chains; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.created_project_chains IS 'Per-chain records for project creation. Tracks transaction status and project IDs per chain.';


--
-- Name: created_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.created_projects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    project_name character varying(255) NOT NULL,
    project_uri character varying(255),
    project_type character varying(20) NOT NULL,
    sucker_group_id character varying(66),
    creation_bundle_id character varying(66),
    creation_status character varying(30) DEFAULT 'pending'::character varying,
    split_operator character varying(42),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT created_projects_creation_status_check CHECK (((creation_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'partial'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT created_projects_project_type_check CHECK (((project_type)::text = ANY ((ARRAY['project'::character varying, 'revnet'::character varying])::text[])))
);


--
-- Name: TABLE created_projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.created_projects IS 'Master record for projects/revnets created through juicy-vision. One per creation action, links to per-chain records.';


--
-- Name: created_revnet_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.created_revnet_stages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    created_project_id uuid NOT NULL,
    stage_index integer NOT NULL,
    starts_at_or_after integer NOT NULL,
    split_percent integer NOT NULL,
    initial_issuance character varying(78) NOT NULL,
    issuance_decay_frequency integer NOT NULL,
    issuance_decay_percent integer NOT NULL,
    cash_out_tax_rate integer NOT NULL,
    extra_metadata integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE created_revnet_stages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.created_revnet_stages IS 'Stage configurations for revnet deployments. Preserves the exact config used at creation.';


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    user_id uuid,
    event_type character varying(100) NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fiat_payment_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiat_payment_disputes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    pending_payment_id uuid NOT NULL,
    stripe_dispute_id character varying(255) NOT NULL,
    dispute_reason character varying(100),
    dispute_status character varying(50),
    dispute_amount_cents integer,
    resolved_at timestamp with time zone,
    resolution character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: juice_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juice_balances (
    user_id uuid NOT NULL,
    balance numeric(20,2) DEFAULT 0 NOT NULL,
    lifetime_purchased numeric(20,2) DEFAULT 0 NOT NULL,
    lifetime_spent numeric(20,2) DEFAULT 0 NOT NULL,
    lifetime_cashed_out numeric(20,2) DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '1000 years'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT juice_balances_balance_check CHECK ((balance >= (0)::numeric))
);


--
-- Name: TABLE juice_balances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.juice_balances IS 'User Juice balances. 1 Juice = $1 USD. Non-refundable, non-transferable.';


--
-- Name: juice_cash_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juice_cash_outs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    destination_address character varying(42) NOT NULL,
    chain_id integer DEFAULT 1 NOT NULL,
    juice_amount numeric(20,2) NOT NULL,
    crypto_amount character varying(78),
    eth_usd_rate numeric(12,4),
    token_address character varying(42),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    available_at timestamp with time zone NOT NULL,
    tx_hash character varying(66),
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT juice_cash_outs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: TABLE juice_cash_outs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.juice_cash_outs IS 'Juice → Crypto withdrawals to user wallet. Delayed for fraud protection.';


--
-- Name: juice_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juice_purchases (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    stripe_payment_intent_id character varying(255) NOT NULL,
    stripe_charge_id character varying(255),
    radar_risk_score integer,
    radar_risk_level character varying(20),
    fiat_amount numeric(20,2) NOT NULL,
    juice_amount numeric(20,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    settlement_delay_days integer DEFAULT 0 NOT NULL,
    clears_at timestamp with time zone,
    credited_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT juice_purchases_radar_risk_score_check CHECK (((radar_risk_score IS NULL) OR ((radar_risk_score >= 0) AND (radar_risk_score <= 100)))),
    CONSTRAINT juice_purchases_settlement_delay_days_check CHECK (((settlement_delay_days >= 0) AND (settlement_delay_days <= 120))),
    CONSTRAINT juice_purchases_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'clearing'::character varying, 'credited'::character varying, 'disputed'::character varying, 'refunded'::character varying])::text[])))
);


--
-- Name: TABLE juice_purchases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.juice_purchases IS 'Fiat → Juice purchases via Stripe. Risk-based clearing delay before crediting.';


--
-- Name: juice_pending_credits; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.juice_pending_credits AS
 SELECT id,
    user_id,
    juice_amount,
    clears_at,
    status
   FROM public.juice_purchases
  WHERE (((status)::text = 'clearing'::text) AND (clears_at <= now()));


--
-- Name: juice_spends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juice_spends (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    project_id integer NOT NULL,
    chain_id integer NOT NULL,
    beneficiary_address character varying(42) NOT NULL,
    memo text,
    juice_amount numeric(20,2) NOT NULL,
    crypto_amount character varying(78),
    eth_usd_rate numeric(12,4),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    tx_hash character varying(66),
    tokens_received character varying(78),
    nfts_received jsonb,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    last_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT juice_spends_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'executing'::character varying, 'completed'::character varying, 'failed'::character varying, 'refunded'::character varying])::text[])))
);


--
-- Name: TABLE juice_spends; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.juice_spends IS 'Juice → Juicebox project payments. Deducted immediately, executed asynchronously.';


--
-- Name: juice_transactions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.juice_transactions AS
 SELECT juice_purchases.id,
    juice_purchases.user_id,
    'purchase'::text AS type,
    juice_purchases.juice_amount AS amount,
    juice_purchases.status,
    juice_purchases.created_at,
    NULL::integer AS project_id,
    NULL::integer AS chain_id
   FROM public.juice_purchases
UNION ALL
 SELECT juice_spends.id,
    juice_spends.user_id,
    'spend'::text AS type,
    (- juice_spends.juice_amount) AS amount,
    juice_spends.status,
    juice_spends.created_at,
    juice_spends.project_id,
    juice_spends.chain_id
   FROM public.juice_spends
UNION ALL
 SELECT juice_cash_outs.id,
    juice_cash_outs.user_id,
    'cash_out'::text AS type,
    (- juice_cash_outs.juice_amount) AS amount,
    juice_cash_outs.status,
    juice_cash_outs.created_at,
    NULL::integer AS project_id,
    juice_cash_outs.chain_id
   FROM public.juice_cash_outs;


--
-- Name: juicy_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juicy_feedback (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid,
    session_id uuid,
    user_address character varying(42),
    user_id uuid,
    rating public.juicy_rating NOT NULL,
    custom_feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: juicy_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juicy_identities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    address character varying(42) NOT NULL,
    emoji character varying(10) NOT NULL,
    username character varying(20) NOT NULL,
    username_lower character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE juicy_identities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.juicy_identities IS 'Unique juicy identities in format [emoji]username that resolve to addresses';


--
-- Name: COLUMN juicy_identities.emoji; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.juicy_identities.emoji IS 'The fruit/juice emoji (e.g., 🍉, 🍑, 🧃)';


--
-- Name: COLUMN juicy_identities.username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.juicy_identities.username IS 'Display username (preserves case)';


--
-- Name: COLUMN juicy_identities.username_lower; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.juicy_identities.username_lower IS 'Lowercase username for case-insensitive uniqueness';


--
-- Name: juicy_identity_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.juicy_identity_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    address character varying(42) NOT NULL,
    emoji character varying(10) NOT NULL,
    username character varying(20) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone DEFAULT now() NOT NULL,
    change_type character varying(20) NOT NULL,
    CONSTRAINT juicy_identity_history_change_type_check CHECK (((change_type)::text = ANY ((ARRAY['created'::character varying, 'updated'::character varying, 'deleted'::character varying])::text[])))
);


--
-- Name: TABLE juicy_identity_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.juicy_identity_history IS 'History of identity changes - tracks all past identities for each address';


--
-- Name: multi_chat_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multi_chat_invites (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    invited_address character varying(42),
    invite_code character varying(32),
    created_by_address character varying(42) NOT NULL,
    max_uses integer,
    uses_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: multi_chat_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multi_chat_keys (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    member_address character varying(42) NOT NULL,
    encrypted_key text NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: multi_chat_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multi_chat_members (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    member_address character varying(42) NOT NULL,
    member_user_id uuid,
    role public.chat_member_role DEFAULT 'member'::public.chat_member_role NOT NULL,
    can_invite boolean DEFAULT false NOT NULL,
    can_invoke_ai boolean DEFAULT true NOT NULL,
    can_manage_members boolean DEFAULT false NOT NULL,
    public_key text,
    is_active boolean DEFAULT true NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone,
    can_send_messages boolean DEFAULT true NOT NULL,
    custom_emoji character varying(10),
    display_name character varying(100),
    can_pause_ai boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN multi_chat_members.custom_emoji; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.multi_chat_members.custom_emoji IS 'User-selected emoji/icon (e.g., 🍊, 🍉) - synced across all their chats';


--
-- Name: multi_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multi_chat_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid NOT NULL,
    sender_address character varying(42) NOT NULL,
    sender_user_id uuid,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    is_encrypted boolean DEFAULT false NOT NULL,
    ai_cost_wei character varying(78),
    ai_model character varying(50),
    signature text,
    reply_to_id uuid,
    ipfs_cid character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    token_count integer,
    CONSTRAINT multi_chat_messages_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: COLUMN multi_chat_messages.token_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.multi_chat_messages.token_count IS 'Estimated token count for this message content. Used for context budget management.';


--
-- Name: multi_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multi_chats (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    founder_address character varying(42) NOT NULL,
    founder_user_id uuid,
    name character varying(255),
    description text,
    is_public boolean DEFAULT false NOT NULL,
    ipfs_cid character varying(64),
    last_archived_at timestamp with time zone,
    token_gate_enabled boolean DEFAULT false NOT NULL,
    token_gate_chain_id integer,
    token_gate_token_address character varying(42),
    token_gate_project_id integer,
    token_gate_min_balance character varying(78),
    ai_balance_wei character varying(78) DEFAULT '0'::character varying NOT NULL,
    ai_total_spent_wei character varying(78) DEFAULT '0'::character varying NOT NULL,
    encrypted boolean DEFAULT false NOT NULL,
    encryption_version integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    pin_order integer,
    folder_id uuid,
    auto_generated_title character varying(255),
    ai_enabled boolean DEFAULT true NOT NULL,
    last_summarized_message_id uuid,
    total_message_count integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN multi_chats.last_summarized_message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.multi_chats.last_summarized_message_id IS 'The last message that was included in a summary. Messages after this are raw in context.';


--
-- Name: oauth_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_connections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(50) NOT NULL,
    provider_user_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    code character varying(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: passkey_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey_challenges (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    challenge bytea NOT NULL,
    challenge_b64 character varying(128) NOT NULL,
    type character varying(20) NOT NULL,
    user_id uuid,
    email character varying(255),
    expires_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT passkey_challenges_type_check CHECK (((type)::text = ANY ((ARRAY['registration'::character varying, 'authentication'::character varying])::text[])))
);


--
-- Name: passkey_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey_credentials (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    credential_id bytea NOT NULL,
    credential_id_b64 character varying(512) NOT NULL,
    public_key bytea NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    device_type character varying(50),
    transports text[],
    backup_eligible boolean DEFAULT false NOT NULL,
    backup_state boolean DEFAULT false NOT NULL,
    display_name character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT passkey_has_user CHECK ((user_id IS NOT NULL))
);


--
-- Name: passkey_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey_wallets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    credential_id character varying(512) NOT NULL,
    wallet_address character varying(42) NOT NULL,
    primary_wallet_address character varying(42),
    device_name character varying(100),
    device_type character varying(50),
    wallet_session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: payment_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_executions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    stripe_payment_id character varying(255) NOT NULL,
    amount_usd numeric(10,2) NOT NULL,
    project_id integer NOT NULL,
    chain_id integer NOT NULL,
    memo text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    tx_hash character varying(66),
    tokens_received character varying(78),
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT payment_executions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: pending_fiat_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_fiat_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    stripe_payment_intent_id character varying(255) NOT NULL,
    stripe_charge_id character varying(255),
    amount_usd numeric(10,2) NOT NULL,
    amount_cents integer NOT NULL,
    project_id integer NOT NULL,
    chain_id integer NOT NULL,
    memo text,
    beneficiary_address character varying(42) NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    settles_at timestamp with time zone NOT NULL,
    status character varying(30) DEFAULT 'pending_settlement'::character varying NOT NULL,
    settled_at timestamp with time zone,
    settlement_rate_eth_usd numeric(12,4),
    settlement_amount_wei character varying(78),
    settlement_tx_hash character varying(66),
    tokens_received character varying(78),
    error_message text,
    retry_count integer DEFAULT 0,
    last_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    risk_score integer,
    settlement_delay_days integer DEFAULT 7 NOT NULL,
    CONSTRAINT pending_fiat_payments_risk_score_check CHECK (((risk_score IS NULL) OR ((risk_score >= 0) AND (risk_score <= 100)))),
    CONSTRAINT pending_fiat_payments_settlement_delay_days_check CHECK (((settlement_delay_days >= 0) AND (settlement_delay_days <= 120))),
    CONSTRAINT pending_fiat_payments_status_check CHECK (((status)::text = ANY ((ARRAY['pending_settlement'::character varying, 'settling'::character varying, 'settled'::character varying, 'disputed'::character varying, 'refunded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: COLUMN pending_fiat_payments.settles_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pending_fiat_payments.settles_at IS 'Settlement date (paid_at + settlement_delay_days based on risk score)';


--
-- Name: COLUMN pending_fiat_payments.risk_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pending_fiat_payments.risk_score IS 'Stripe Radar risk score (0-100, higher = riskier). Used to calculate settlement delay.';


--
-- Name: COLUMN pending_fiat_payments.settlement_delay_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pending_fiat_payments.settlement_delay_days IS 'Settlement delay in days based on risk score. 0 = immediate, up to 120 for high risk.';


--
-- Name: pending_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_transfers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    chain_id integer NOT NULL,
    token_address character varying(42) NOT NULL,
    token_symbol character varying(20) NOT NULL,
    amount character varying(78) NOT NULL,
    to_address character varying(42) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    tx_hash character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    available_at timestamp with time zone NOT NULL,
    executed_at timestamp with time zone,
    CONSTRAINT pending_transfers_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'ready'::character varying, 'executed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: project_pending_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_pending_balances AS
 SELECT project_id,
    chain_id,
    count(*) AS pending_count,
    sum(amount_usd) AS pending_usd,
    min(settles_at) AS next_settlement_at,
    max(settles_at) AS last_settlement_at
   FROM public.pending_fiat_payments
  WHERE ((status)::text = 'pending_settlement'::text)
  GROUP BY project_id, chain_id;


--
-- Name: public_chats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_chats AS
 SELECT id,
    name,
    description,
    founder_address,
    token_gate_enabled,
    token_gate_project_id,
    created_at,
    ( SELECT count(*) AS count
           FROM public.multi_chat_members m
          WHERE ((m.chat_id = mc.id) AND (m.is_active = true))) AS member_count,
    ( SELECT count(*) AS count
           FROM public.multi_chat_messages msg
          WHERE ((msg.chat_id = mc.id) AND (msg.deleted_at IS NULL))) AS message_count
   FROM public.multi_chats mc
  WHERE (is_public = true);


--
-- Name: reserve_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reserve_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chain_id integer NOT NULL,
    token_address character varying(42) NOT NULL,
    amount character varying(78) NOT NULL,
    direction character varying(10) NOT NULL,
    related_payment_id uuid,
    tx_hash character varying(66),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reserve_transactions_direction_check CHECK (((direction)::text = ANY ((ARRAY['in'::character varying, 'out'::character varying])::text[])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: smart_account_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smart_account_balances (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    smart_account_id uuid NOT NULL,
    token_address character varying(42) NOT NULL,
    token_symbol character varying(20) NOT NULL,
    token_decimals integer DEFAULT 18 NOT NULL,
    balance character varying(78) DEFAULT '0'::character varying NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    last_synced_block bigint
);


--
-- Name: smart_account_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smart_account_exports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    new_owner_address character varying(42) NOT NULL,
    chain_ids integer[] NOT NULL,
    chain_status jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    blocked_by_pending_ops boolean DEFAULT false NOT NULL,
    pending_ops_details jsonb,
    export_snapshot jsonb,
    user_confirmed_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    last_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT smart_account_exports_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'blocked'::character varying, 'processing'::character varying, 'completed'::character varying, 'partial'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: COLUMN smart_account_exports.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.smart_account_exports.status IS 'pending: awaiting user confirmation
   blocked: has pending operations that must complete first
   processing: actively transferring ownership
   completed: all chains transferred successfully
   partial: some chains succeeded, some failed (can retry failed)
   failed: all chains failed
   cancelled: user cancelled the export';


--
-- Name: smart_account_project_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smart_account_project_roles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    smart_account_id uuid NOT NULL,
    project_id integer NOT NULL,
    chain_id integer NOT NULL,
    role_type character varying(30) NOT NULL,
    split_group integer,
    percent_bps integer,
    set_tx_hash character varying(66),
    set_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT smart_account_project_roles_role_type_check CHECK (((role_type)::text = ANY ((ARRAY['payout_recipient'::character varying, 'reserved_recipient'::character varying, 'operator'::character varying])::text[])))
);


--
-- Name: smart_account_withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smart_account_withdrawals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    smart_account_id uuid NOT NULL,
    token_address character varying(42) NOT NULL,
    amount character varying(78) NOT NULL,
    to_address character varying(42) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    tx_hash character varying(66),
    executed_at timestamp with time zone,
    error_message text,
    gas_sponsored boolean DEFAULT true NOT NULL,
    gas_cost_wei character varying(78),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT smart_account_withdrawals_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: training_bad_conversations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.training_bad_conversations AS
SELECT
    NULL::uuid AS session_id,
    NULL::character varying(20) AS mode,
    NULL::json[] AS messages,
    NULL::boolean AS outcome_error_encountered,
    NULL::boolean AS outcome_user_abandoned,
    NULL::integer AS session_rating,
    NULL::text AS session_feedback;


--
-- Name: training_good_conversations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.training_good_conversations AS
SELECT
    NULL::uuid AS session_id,
    NULL::character varying(20) AS mode,
    NULL::json[] AS messages,
    NULL::boolean AS outcome_completed_payment,
    NULL::boolean AS outcome_found_project,
    NULL::integer AS session_rating;


--
-- Name: training_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_runs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status character varying(20) DEFAULT 'running'::character varying NOT NULL,
    conversations_analyzed integer DEFAULT 0,
    suggestions_generated integer DEFAULT 0,
    few_shot_examples_created integer DEFAULT 0,
    output_path text,
    error_message text,
    stats jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT training_runs_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    session_id uuid,
    tx_hash character varying(66),
    chain_id integer NOT NULL,
    from_address character varying(42) NOT NULL,
    to_address character varying(42) NOT NULL,
    token_address character varying(42),
    amount character varying(78) NOT NULL,
    project_id character varying(20),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    receipt jsonb,
    CONSTRAINT transactions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'submitted'::character varying, 'confirmed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: user_active_chats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_active_chats AS
 SELECT mc.id,
    mc.name,
    mc.description,
    mc.is_public,
    mc.encrypted,
    mc.ai_balance_wei,
    mcm.member_address,
    mcm.role,
    mcm.can_invoke_ai,
    ( SELECT count(*) AS count
           FROM public.multi_chat_members m
          WHERE ((m.chat_id = mc.id) AND (m.is_active = true))) AS member_count,
    ( SELECT max(msg.created_at) AS max
           FROM public.multi_chat_messages msg
          WHERE ((msg.chat_id = mc.id) AND (msg.deleted_at IS NULL))) AS last_message_at
   FROM (public.multi_chats mc
     JOIN public.multi_chat_members mcm ON ((mcm.chat_id = mc.id)))
  WHERE (mcm.is_active = true);


--
-- Name: user_contexts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contexts (
    user_id uuid NOT NULL,
    wallet_address character varying(42),
    context_md text NOT NULL,
    jargon_level character varying(20) DEFAULT 'beginner'::character varying NOT NULL,
    familiar_terms text[] DEFAULT '{}'::text[],
    observations jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_contexts_jargon_level_check CHECK (((jargon_level)::text = ANY ((ARRAY['beginner'::character varying, 'intermediate'::character varying, 'advanced'::character varying])::text[])))
);


--
-- Name: user_keypairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_keypairs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    public_key text NOT NULL,
    encrypted_private_key text NOT NULL,
    algorithm character varying(20) DEFAULT 'x25519'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: user_pending_payments; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_pending_payments AS
 SELECT user_id,
    count(*) AS pending_count,
    sum(amount_usd) AS pending_usd,
    min(settles_at) AS next_settlement_at,
    json_agg(json_build_object('id', id, 'project_id', project_id, 'chain_id', chain_id, 'amount_usd', amount_usd, 'settles_at', settles_at, 'status', status) ORDER BY settles_at) AS payments
   FROM public.pending_fiat_payments
  WHERE ((status)::text = ANY ((ARRAY['pending_settlement'::character varying, 'settling'::character varying])::text[]))
  GROUP BY user_id;


--
-- Name: user_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_regions (
    id integer NOT NULL,
    ip_hash character varying(32) NOT NULL,
    country_code character varying(3) NOT NULL,
    country character varying(100) NOT NULL,
    region character varying(100),
    city character varying(100),
    suggested_language character varying(10) NOT NULL,
    language_used character varying(10) NOT NULL,
    user_id uuid,
    visited_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_regions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_regions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_regions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_regions_id_seq OWNED BY public.user_regions.id;


--
-- Name: user_smart_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_smart_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    chain_id integer NOT NULL,
    address character varying(42) NOT NULL,
    salt character varying(66) NOT NULL,
    deployed boolean DEFAULT false NOT NULL,
    deploy_tx_hash character varying(66),
    deployed_at timestamp with time zone,
    custody_status character varying(20) DEFAULT 'managed'::character varying NOT NULL,
    owner_address character varying(42),
    custody_transferred_at timestamp with time zone,
    custody_transfer_tx_hash character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_smart_accounts_custody_status_check CHECK (((custody_status)::text = ANY ((ARRAY['managed'::character varying, 'transferring'::character varying, 'self_custody'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    privacy_mode character varying(20) DEFAULT 'open_book'::character varying NOT NULL,
    custodial_address_index integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    passkey_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT users_privacy_mode_check CHECK (((privacy_mode)::text = ANY ((ARRAY['open_book'::character varying, 'anonymous'::character varying, 'private'::character varying, 'ghost'::character varying])::text[])))
);


--
-- Name: wallet_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    wallet_address character varying(42) NOT NULL,
    siwe_message text,
    siwe_signature text,
    nonce character varying(32),
    session_token character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    anonymous_session_id character varying(64)
);


--
-- Name: user_regions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_regions ALTER COLUMN id SET DEFAULT nextval('public.user_regions_id_seq'::regclass);


--
-- Name: ai_billing ai_billing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_billing
    ADD CONSTRAINT ai_billing_pkey PRIMARY KEY (id);


--
-- Name: applied_training_suggestions applied_training_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applied_training_suggestions
    ADD CONSTRAINT applied_training_suggestions_pkey PRIMARY KEY (id);


--
-- Name: attachment_summaries attachment_summaries_message_id_attachment_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_summaries
    ADD CONSTRAINT attachment_summaries_message_id_attachment_index_key UNIQUE (message_id, attachment_index);


--
-- Name: attachment_summaries attachment_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_summaries
    ADD CONSTRAINT attachment_summaries_pkey PRIMARY KEY (id);


--
-- Name: chat_events chat_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_events
    ADD CONSTRAINT chat_events_pkey PRIMARY KEY (id);


--
-- Name: chat_folders chat_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_folders
    ADD CONSTRAINT chat_folders_pkey PRIMARY KEY (id);


--
-- Name: chat_invites chat_invites_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_invites
    ADD CONSTRAINT chat_invites_code_key UNIQUE (code);


--
-- Name: chat_invites chat_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_invites
    ADD CONSTRAINT chat_invites_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_reports chat_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_reports
    ADD CONSTRAINT chat_reports_pkey PRIMARY KEY (id);


--
-- Name: chat_reports chat_reports_unique_per_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_reports
    ADD CONSTRAINT chat_reports_unique_per_user UNIQUE (chat_id, reporter_address);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: chat_summaries chat_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_summaries
    ADD CONSTRAINT chat_summaries_pkey PRIMARY KEY (id);


--
-- Name: chat_transaction_state chat_transaction_state_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_transaction_state
    ADD CONSTRAINT chat_transaction_state_chat_id_key UNIQUE (chat_id);


--
-- Name: chat_transaction_state chat_transaction_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_transaction_state
    ADD CONSTRAINT chat_transaction_state_pkey PRIMARY KEY (id);


--
-- Name: context_usage_log context_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_usage_log
    ADD CONSTRAINT context_usage_log_pkey PRIMARY KEY (id);


--
-- Name: corrections corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_pkey PRIMARY KEY (id);


--
-- Name: created_project_chains created_project_chains_created_project_id_chain_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_project_chains
    ADD CONSTRAINT created_project_chains_created_project_id_chain_id_key UNIQUE (created_project_id, chain_id);


--
-- Name: created_project_chains created_project_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_project_chains
    ADD CONSTRAINT created_project_chains_pkey PRIMARY KEY (id);


--
-- Name: created_projects created_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_projects
    ADD CONSTRAINT created_projects_pkey PRIMARY KEY (id);


--
-- Name: created_revnet_stages created_revnet_stages_created_project_id_stage_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_revnet_stages
    ADD CONSTRAINT created_revnet_stages_created_project_id_stage_index_key UNIQUE (created_project_id, stage_index);


--
-- Name: created_revnet_stages created_revnet_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_revnet_stages
    ADD CONSTRAINT created_revnet_stages_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: fiat_payment_disputes fiat_payment_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiat_payment_disputes
    ADD CONSTRAINT fiat_payment_disputes_pkey PRIMARY KEY (id);


--
-- Name: juice_balances juice_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_balances
    ADD CONSTRAINT juice_balances_pkey PRIMARY KEY (user_id);


--
-- Name: juice_cash_outs juice_cash_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_cash_outs
    ADD CONSTRAINT juice_cash_outs_pkey PRIMARY KEY (id);


--
-- Name: juice_purchases juice_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_purchases
    ADD CONSTRAINT juice_purchases_pkey PRIMARY KEY (id);


--
-- Name: juice_purchases juice_purchases_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_purchases
    ADD CONSTRAINT juice_purchases_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);


--
-- Name: juice_spends juice_spends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_spends
    ADD CONSTRAINT juice_spends_pkey PRIMARY KEY (id);


--
-- Name: juicy_feedback juicy_feedback_chat_id_user_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_feedback
    ADD CONSTRAINT juicy_feedback_chat_id_user_address_key UNIQUE (chat_id, user_address);


--
-- Name: juicy_feedback juicy_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_feedback
    ADD CONSTRAINT juicy_feedback_pkey PRIMARY KEY (id);


--
-- Name: juicy_feedback juicy_feedback_session_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_feedback
    ADD CONSTRAINT juicy_feedback_session_id_user_id_key UNIQUE (session_id, user_id);


--
-- Name: juicy_identities juicy_identities_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_identities
    ADD CONSTRAINT juicy_identities_address_key UNIQUE (address);


--
-- Name: juicy_identities juicy_identities_emoji_username_lower_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_identities
    ADD CONSTRAINT juicy_identities_emoji_username_lower_key UNIQUE (emoji, username_lower);


--
-- Name: juicy_identities juicy_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_identities
    ADD CONSTRAINT juicy_identities_pkey PRIMARY KEY (id);


--
-- Name: juicy_identity_history juicy_identity_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_identity_history
    ADD CONSTRAINT juicy_identity_history_pkey PRIMARY KEY (id);


--
-- Name: multi_chat_invites multi_chat_invites_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_invites
    ADD CONSTRAINT multi_chat_invites_invite_code_key UNIQUE (invite_code);


--
-- Name: multi_chat_invites multi_chat_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_invites
    ADD CONSTRAINT multi_chat_invites_pkey PRIMARY KEY (id);


--
-- Name: multi_chat_keys multi_chat_keys_chat_id_member_address_key_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_keys
    ADD CONSTRAINT multi_chat_keys_chat_id_member_address_key_version_key UNIQUE (chat_id, member_address, key_version);


--
-- Name: multi_chat_keys multi_chat_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_keys
    ADD CONSTRAINT multi_chat_keys_pkey PRIMARY KEY (id);


--
-- Name: multi_chat_members multi_chat_members_chat_id_member_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_members
    ADD CONSTRAINT multi_chat_members_chat_id_member_address_key UNIQUE (chat_id, member_address);


--
-- Name: multi_chat_members multi_chat_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_members
    ADD CONSTRAINT multi_chat_members_pkey PRIMARY KEY (id);


--
-- Name: multi_chat_messages multi_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_messages
    ADD CONSTRAINT multi_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: multi_chats multi_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chats
    ADD CONSTRAINT multi_chats_pkey PRIMARY KEY (id);


--
-- Name: oauth_connections oauth_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_connections
    ADD CONSTRAINT oauth_connections_pkey PRIMARY KEY (id);


--
-- Name: oauth_connections oauth_connections_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_connections
    ADD CONSTRAINT oauth_connections_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: passkey_challenges passkey_challenges_challenge_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_challenges
    ADD CONSTRAINT passkey_challenges_challenge_key UNIQUE (challenge);


--
-- Name: passkey_challenges passkey_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_challenges
    ADD CONSTRAINT passkey_challenges_pkey PRIMARY KEY (id);


--
-- Name: passkey_credentials passkey_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_credentials
    ADD CONSTRAINT passkey_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: passkey_credentials passkey_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_credentials
    ADD CONSTRAINT passkey_credentials_pkey PRIMARY KEY (id);


--
-- Name: passkey_wallets passkey_wallets_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_wallets
    ADD CONSTRAINT passkey_wallets_credential_id_key UNIQUE (credential_id);


--
-- Name: passkey_wallets passkey_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_wallets
    ADD CONSTRAINT passkey_wallets_pkey PRIMARY KEY (id);


--
-- Name: payment_executions payment_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_executions
    ADD CONSTRAINT payment_executions_pkey PRIMARY KEY (id);


--
-- Name: payment_executions payment_executions_stripe_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_executions
    ADD CONSTRAINT payment_executions_stripe_payment_id_key UNIQUE (stripe_payment_id);


--
-- Name: pending_fiat_payments pending_fiat_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_fiat_payments
    ADD CONSTRAINT pending_fiat_payments_pkey PRIMARY KEY (id);


--
-- Name: pending_fiat_payments pending_fiat_payments_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_fiat_payments
    ADD CONSTRAINT pending_fiat_payments_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);


--
-- Name: pending_transfers pending_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_pkey PRIMARY KEY (id);


--
-- Name: reserve_transactions reserve_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserve_transactions
    ADD CONSTRAINT reserve_transactions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: smart_account_balances smart_account_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_balances
    ADD CONSTRAINT smart_account_balances_pkey PRIMARY KEY (id);


--
-- Name: smart_account_balances smart_account_balances_smart_account_id_token_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_balances
    ADD CONSTRAINT smart_account_balances_smart_account_id_token_address_key UNIQUE (smart_account_id, token_address);


--
-- Name: smart_account_exports smart_account_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_exports
    ADD CONSTRAINT smart_account_exports_pkey PRIMARY KEY (id);


--
-- Name: smart_account_project_roles smart_account_project_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_project_roles
    ADD CONSTRAINT smart_account_project_roles_pkey PRIMARY KEY (id);


--
-- Name: smart_account_withdrawals smart_account_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_withdrawals
    ADD CONSTRAINT smart_account_withdrawals_pkey PRIMARY KEY (id);


--
-- Name: training_runs training_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_runs
    ADD CONSTRAINT training_runs_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_contexts user_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contexts
    ADD CONSTRAINT user_contexts_pkey PRIMARY KEY (user_id);


--
-- Name: user_keypairs user_keypairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_keypairs
    ADD CONSTRAINT user_keypairs_pkey PRIMARY KEY (id);


--
-- Name: user_regions user_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_regions
    ADD CONSTRAINT user_regions_pkey PRIMARY KEY (id);


--
-- Name: user_smart_accounts user_smart_accounts_chain_id_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_smart_accounts
    ADD CONSTRAINT user_smart_accounts_chain_id_address_key UNIQUE (chain_id, address);


--
-- Name: user_smart_accounts user_smart_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_smart_accounts
    ADD CONSTRAINT user_smart_accounts_pkey PRIMARY KEY (id);


--
-- Name: user_smart_accounts user_smart_accounts_user_id_chain_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_smart_accounts
    ADD CONSTRAINT user_smart_accounts_user_id_chain_id_key UNIQUE (user_id, chain_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallet_sessions wallet_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_sessions
    ADD CONSTRAINT wallet_sessions_pkey PRIMARY KEY (id);


--
-- Name: wallet_sessions wallet_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_sessions
    ADD CONSTRAINT wallet_sessions_session_token_key UNIQUE (session_token);


--
-- Name: wallet_sessions wallet_sessions_wallet_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_sessions
    ADD CONSTRAINT wallet_sessions_wallet_address_key UNIQUE (wallet_address);


--
-- Name: idx_account_roles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_roles_active ON public.smart_account_project_roles USING btree (active) WHERE (active = true);


--
-- Name: idx_account_roles_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_roles_project ON public.smart_account_project_roles USING btree (project_id, chain_id);


--
-- Name: idx_account_roles_smart_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_roles_smart_account ON public.smart_account_project_roles USING btree (smart_account_id);


--
-- Name: idx_ai_billing_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_billing_chat_id ON public.ai_billing USING btree (chat_id);


--
-- Name: idx_ai_billing_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_billing_created_at ON public.ai_billing USING btree (created_at);


--
-- Name: idx_ai_billing_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_billing_type ON public.ai_billing USING btree (type);


--
-- Name: idx_applied_suggestions_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applied_suggestions_run ON public.applied_training_suggestions USING btree (training_run_id);


--
-- Name: idx_attachment_summaries_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_summaries_chat ON public.attachment_summaries USING btree (chat_id, created_at DESC);


--
-- Name: idx_attachment_summaries_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachment_summaries_message ON public.attachment_summaries USING btree (message_id);


--
-- Name: idx_chat_events_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_events_chat ON public.chat_events USING btree (chat_id);


--
-- Name: idx_chat_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_events_created ON public.chat_events USING btree (created_at);


--
-- Name: idx_chat_folders_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_folders_parent ON public.chat_folders USING btree (parent_folder_id);


--
-- Name: idx_chat_folders_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_folders_pinned ON public.chat_folders USING btree (user_address, is_pinned) WHERE (is_pinned = true);


--
-- Name: idx_chat_folders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_folders_user ON public.chat_folders USING btree (user_address);


--
-- Name: idx_chat_invites_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_invites_chat ON public.chat_invites USING btree (chat_id);


--
-- Name: idx_chat_invites_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_invites_code ON public.chat_invites USING btree (code);


--
-- Name: idx_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at);


--
-- Name: idx_chat_messages_feedback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_feedback ON public.chat_messages USING btree (feedback_helpful, feedback_reported);


--
-- Name: idx_chat_messages_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_session_id ON public.chat_messages USING btree (session_id);


--
-- Name: idx_chat_reports_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_reports_chat_id ON public.chat_reports USING btree (chat_id);


--
-- Name: idx_chat_reports_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_reports_created_at ON public.chat_reports USING btree (created_at DESC);


--
-- Name: idx_chat_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_reports_status ON public.chat_reports USING btree (status);


--
-- Name: idx_chat_sessions_privacy_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_privacy_mode ON public.chat_sessions USING btree (privacy_mode);


--
-- Name: idx_chat_sessions_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_started_at ON public.chat_sessions USING btree (started_at);


--
-- Name: idx_chat_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions USING btree (user_id);


--
-- Name: idx_chat_summaries_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_summaries_chat ON public.chat_summaries USING btree (chat_id, created_at DESC);


--
-- Name: idx_chat_summaries_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_summaries_range ON public.chat_summaries USING btree (chat_id, covers_to_created_at DESC);


--
-- Name: idx_chat_transaction_state_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_transaction_state_chat ON public.chat_transaction_state USING btree (chat_id);


--
-- Name: idx_context_usage_log_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_usage_log_chat ON public.context_usage_log USING btree (chat_id, created_at DESC);


--
-- Name: idx_corrections_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corrections_created_at ON public.corrections USING btree (created_at);


--
-- Name: idx_corrections_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corrections_status ON public.corrections USING btree (status);


--
-- Name: idx_created_project_chains_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_project_chains_chain ON public.created_project_chains USING btree (chain_id);


--
-- Name: idx_created_project_chains_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_project_chains_project ON public.created_project_chains USING btree (created_project_id);


--
-- Name: idx_created_project_chains_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_project_chains_project_id ON public.created_project_chains USING btree (project_id);


--
-- Name: idx_created_project_chains_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_project_chains_status ON public.created_project_chains USING btree (status);


--
-- Name: idx_created_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_projects_status ON public.created_projects USING btree (creation_status);


--
-- Name: idx_created_projects_sucker_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_projects_sucker_group ON public.created_projects USING btree (sucker_group_id);


--
-- Name: idx_created_projects_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_projects_user ON public.created_projects USING btree (user_id);


--
-- Name: idx_created_revnet_stages_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_created_revnet_stages_project ON public.created_revnet_stages USING btree (created_project_id);


--
-- Name: idx_disputes_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_payment ON public.fiat_payment_disputes USING btree (pending_payment_id);


--
-- Name: idx_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_created_at ON public.events USING btree (created_at);


--
-- Name: idx_events_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_session_id ON public.events USING btree (session_id);


--
-- Name: idx_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_type ON public.events USING btree (event_type);


--
-- Name: idx_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_user_id ON public.events USING btree (user_id);


--
-- Name: idx_exports_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_pending ON public.smart_account_exports USING btree (status) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying])::text[]));


--
-- Name: idx_exports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_status ON public.smart_account_exports USING btree (status);


--
-- Name: idx_exports_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_user ON public.smart_account_exports USING btree (user_id);


--
-- Name: idx_juice_cash_outs_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_cash_outs_available ON public.juice_cash_outs USING btree (available_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_juice_cash_outs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_cash_outs_status ON public.juice_cash_outs USING btree (status);


--
-- Name: idx_juice_cash_outs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_cash_outs_user ON public.juice_cash_outs USING btree (user_id);


--
-- Name: idx_juice_purchases_clears; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_purchases_clears ON public.juice_purchases USING btree (clears_at) WHERE ((status)::text = 'clearing'::text);


--
-- Name: idx_juice_purchases_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_purchases_status ON public.juice_purchases USING btree (status);


--
-- Name: idx_juice_purchases_stripe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_purchases_stripe ON public.juice_purchases USING btree (stripe_payment_intent_id);


--
-- Name: idx_juice_purchases_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_purchases_user ON public.juice_purchases USING btree (user_id);


--
-- Name: idx_juice_spends_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_spends_pending ON public.juice_spends USING btree (created_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_juice_spends_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_spends_project ON public.juice_spends USING btree (project_id, chain_id);


--
-- Name: idx_juice_spends_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_spends_status ON public.juice_spends USING btree (status);


--
-- Name: idx_juice_spends_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juice_spends_user ON public.juice_spends USING btree (user_id);


--
-- Name: idx_juicy_feedback_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juicy_feedback_created_at ON public.juicy_feedback USING btree (created_at);


--
-- Name: idx_juicy_feedback_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juicy_feedback_rating ON public.juicy_feedback USING btree (rating);


--
-- Name: idx_juicy_identities_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juicy_identities_address ON public.juicy_identities USING btree (address);


--
-- Name: idx_juicy_identities_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juicy_identities_lookup ON public.juicy_identities USING btree (emoji, username_lower);


--
-- Name: idx_juicy_identity_history_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juicy_identity_history_address ON public.juicy_identity_history USING btree (address);


--
-- Name: idx_juicy_identity_history_ended_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_juicy_identity_history_ended_at ON public.juicy_identity_history USING btree (ended_at DESC);


--
-- Name: idx_multi_chat_invites_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_invites_address ON public.multi_chat_invites USING btree (invited_address);


--
-- Name: idx_multi_chat_invites_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_invites_chat_id ON public.multi_chat_invites USING btree (chat_id);


--
-- Name: idx_multi_chat_invites_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_invites_code ON public.multi_chat_invites USING btree (invite_code);


--
-- Name: idx_multi_chat_keys_chat_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_keys_chat_member ON public.multi_chat_keys USING btree (chat_id, member_address);


--
-- Name: idx_multi_chat_members_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_members_active ON public.multi_chat_members USING btree (chat_id, is_active);


--
-- Name: idx_multi_chat_members_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_members_address ON public.multi_chat_members USING btree (member_address);


--
-- Name: idx_multi_chat_members_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_members_chat_id ON public.multi_chat_members USING btree (chat_id);


--
-- Name: idx_multi_chat_members_permissions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_members_permissions ON public.multi_chat_members USING btree (chat_id, member_address, can_send_messages, can_invite);


--
-- Name: idx_multi_chat_messages_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_messages_chat_id ON public.multi_chat_messages USING btree (chat_id);


--
-- Name: idx_multi_chat_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_messages_created_at ON public.multi_chat_messages USING btree (chat_id, created_at);


--
-- Name: idx_multi_chat_messages_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_messages_role ON public.multi_chat_messages USING btree (chat_id, role);


--
-- Name: idx_multi_chat_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chat_messages_sender ON public.multi_chat_messages USING btree (sender_address);


--
-- Name: idx_multi_chats_ai_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chats_ai_enabled ON public.multi_chats USING btree (ai_enabled);


--
-- Name: idx_multi_chats_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chats_created_at ON public.multi_chats USING btree (created_at);


--
-- Name: idx_multi_chats_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chats_folder ON public.multi_chats USING btree (folder_id);


--
-- Name: idx_multi_chats_founder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chats_founder ON public.multi_chats USING btree (founder_address);


--
-- Name: idx_multi_chats_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chats_pinned ON public.multi_chats USING btree (founder_address, is_pinned) WHERE (is_pinned = true);


--
-- Name: idx_multi_chats_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multi_chats_public ON public.multi_chats USING btree (is_public);


--
-- Name: idx_oauth_connections_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_connections_user_id ON public.oauth_connections USING btree (user_id);


--
-- Name: idx_otp_codes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_codes_email ON public.otp_codes USING btree (email);


--
-- Name: idx_otp_codes_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_codes_expires_at ON public.otp_codes USING btree (expires_at);


--
-- Name: idx_passkey_challenges_challenge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_challenges_challenge ON public.passkey_challenges USING btree (challenge_b64);


--
-- Name: idx_passkey_challenges_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_challenges_expires ON public.passkey_challenges USING btree (expires_at);


--
-- Name: idx_passkey_credentials_cred_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_credentials_cred_id ON public.passkey_credentials USING btree (credential_id_b64);


--
-- Name: idx_passkey_credentials_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_credentials_user_id ON public.passkey_credentials USING btree (user_id);


--
-- Name: idx_passkey_wallets_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_wallets_address ON public.passkey_wallets USING btree (wallet_address);


--
-- Name: idx_passkey_wallets_credential; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_wallets_credential ON public.passkey_wallets USING btree (credential_id);


--
-- Name: idx_passkey_wallets_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_wallets_primary ON public.passkey_wallets USING btree (primary_wallet_address);


--
-- Name: idx_payment_executions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_executions_status ON public.payment_executions USING btree (status);


--
-- Name: idx_payment_executions_stripe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_executions_stripe_id ON public.payment_executions USING btree (stripe_payment_id);


--
-- Name: idx_payment_executions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_executions_user_id ON public.payment_executions USING btree (user_id);


--
-- Name: idx_pending_fiat_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_fiat_project ON public.pending_fiat_payments USING btree (project_id, chain_id);


--
-- Name: idx_pending_fiat_risk_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_fiat_risk_score ON public.pending_fiat_payments USING btree (risk_score) WHERE (risk_score IS NOT NULL);


--
-- Name: idx_pending_fiat_settles_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_fiat_settles_at ON public.pending_fiat_payments USING btree (settles_at) WHERE ((status)::text = 'pending_settlement'::text);


--
-- Name: idx_pending_fiat_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_fiat_status ON public.pending_fiat_payments USING btree (status);


--
-- Name: idx_pending_fiat_stripe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_fiat_stripe ON public.pending_fiat_payments USING btree (stripe_payment_intent_id);


--
-- Name: idx_pending_fiat_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_fiat_user ON public.pending_fiat_payments USING btree (user_id);


--
-- Name: idx_pending_transfers_available_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_transfers_available_at ON public.pending_transfers USING btree (available_at);


--
-- Name: idx_pending_transfers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_transfers_status ON public.pending_transfers USING btree (status);


--
-- Name: idx_pending_transfers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_transfers_user_id ON public.pending_transfers USING btree (user_id);


--
-- Name: idx_reserve_transactions_chain_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reserve_transactions_chain_id ON public.reserve_transactions USING btree (chain_id);


--
-- Name: idx_reserve_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reserve_transactions_created_at ON public.reserve_transactions USING btree (created_at);


--
-- Name: idx_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: idx_smart_accounts_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_accounts_address ON public.user_smart_accounts USING btree (address);


--
-- Name: idx_smart_accounts_custody; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_accounts_custody ON public.user_smart_accounts USING btree (custody_status);


--
-- Name: idx_smart_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_accounts_user ON public.user_smart_accounts USING btree (user_id);


--
-- Name: idx_smart_balances_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_balances_account ON public.smart_account_balances USING btree (smart_account_id);


--
-- Name: idx_training_runs_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_runs_started_at ON public.training_runs USING btree (started_at);


--
-- Name: idx_training_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_runs_status ON public.training_runs USING btree (status);


--
-- Name: idx_transactions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_created ON public.transactions USING btree (created_at DESC);


--
-- Name: idx_transactions_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_hash ON public.transactions USING btree (tx_hash) WHERE (tx_hash IS NOT NULL);


--
-- Name: idx_transactions_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_project ON public.transactions USING btree (project_id) WHERE (project_id IS NOT NULL);


--
-- Name: idx_transactions_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_session ON public.transactions USING btree (session_id);


--
-- Name: idx_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_status ON public.transactions USING btree (status);


--
-- Name: idx_transactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_user ON public.transactions USING btree (user_id);


--
-- Name: idx_user_contexts_jargon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contexts_jargon ON public.user_contexts USING btree (jargon_level);


--
-- Name: idx_user_contexts_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contexts_wallet ON public.user_contexts USING btree (wallet_address);


--
-- Name: idx_user_keypairs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_keypairs_active ON public.user_keypairs USING btree (user_id) WHERE (is_active = true);


--
-- Name: idx_user_keypairs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_keypairs_user_id ON public.user_keypairs USING btree (user_id);


--
-- Name: idx_user_regions_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_regions_country ON public.user_regions USING btree (country_code);


--
-- Name: idx_user_regions_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_regions_language ON public.user_regions USING btree (language_used);


--
-- Name: idx_user_regions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_regions_user ON public.user_regions USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_user_regions_visited; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_regions_visited ON public.user_regions USING btree (visited_at);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_wallet_sessions_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_sessions_address ON public.wallet_sessions USING btree (wallet_address);


--
-- Name: idx_wallet_sessions_anonymous; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_sessions_anonymous ON public.wallet_sessions USING btree (anonymous_session_id) WHERE (anonymous_session_id IS NOT NULL);


--
-- Name: idx_wallet_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_sessions_expires ON public.wallet_sessions USING btree (expires_at);


--
-- Name: idx_wallet_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wallet_sessions_token ON public.wallet_sessions USING btree (session_token);


--
-- Name: idx_withdrawals_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawals_account ON public.smart_account_withdrawals USING btree (smart_account_id);


--
-- Name: idx_withdrawals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawals_status ON public.smart_account_withdrawals USING btree (status);


--
-- Name: training_bad_conversations _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.training_bad_conversations AS
 SELECT cs.id AS session_id,
    cs.mode,
    array_agg(json_build_object('role', cm.role, 'content', cm.content) ORDER BY cm.created_at) AS messages,
    cs.outcome_error_encountered,
    cs.outcome_user_abandoned,
    cs.session_rating,
    cs.session_feedback
   FROM (public.chat_sessions cs
     JOIN public.chat_messages cm ON ((cm.session_id = cs.id)))
  WHERE (((cs.privacy_mode)::text = ANY ((ARRAY['open_book'::character varying, 'anonymous'::character varying])::text[])) AND ((cs.session_rating <= 2) OR (cs.outcome_user_abandoned = true) OR (cs.outcome_error_encountered = true) OR (EXISTS ( SELECT 1
           FROM public.chat_messages m
          WHERE ((m.session_id = cs.id) AND (m.feedback_helpful = false))))))
  GROUP BY cs.id;


--
-- Name: training_good_conversations _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.training_good_conversations AS
 SELECT cs.id AS session_id,
    cs.mode,
    array_agg(json_build_object('role', cm.role, 'content', cm.content) ORDER BY cm.created_at) AS messages,
    cs.outcome_completed_payment,
    cs.outcome_found_project,
    cs.session_rating
   FROM (public.chat_sessions cs
     JOIN public.chat_messages cm ON ((cm.session_id = cs.id)))
  WHERE (((cs.privacy_mode)::text = ANY ((ARRAY['open_book'::character varying, 'anonymous'::character varying])::text[])) AND ((cs.session_rating >= 4) OR (cs.outcome_completed_payment = true) OR (EXISTS ( SELECT 1
           FROM public.chat_messages m
          WHERE ((m.session_id = cs.id) AND (m.feedback_helpful = true))))))
  GROUP BY cs.id;


--
-- Name: context_usage_log trigger_cleanup_context_usage_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_cleanup_context_usage_log AFTER INSERT ON public.context_usage_log FOR EACH ROW EXECUTE FUNCTION public.cleanup_context_usage_log();


--
-- Name: chat_folders update_chat_folders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_chat_folders_updated_at BEFORE UPDATE ON public.chat_folders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: chat_transaction_state update_chat_transaction_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_chat_transaction_state_updated_at BEFORE UPDATE ON public.chat_transaction_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: created_project_chains update_created_project_chains_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_created_project_chains_updated_at BEFORE UPDATE ON public.created_project_chains FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: created_projects update_created_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_created_projects_updated_at BEFORE UPDATE ON public.created_projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: juice_balances update_juice_balances_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_juice_balances_updated_at BEFORE UPDATE ON public.juice_balances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: juice_cash_outs update_juice_cash_outs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_juice_cash_outs_updated_at BEFORE UPDATE ON public.juice_cash_outs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: juice_spends update_juice_spends_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_juice_spends_updated_at BEFORE UPDATE ON public.juice_spends FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: juicy_identities update_juicy_identities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_juicy_identities_updated_at BEFORE UPDATE ON public.juicy_identities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: multi_chats update_multi_chats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_multi_chats_updated_at BEFORE UPDATE ON public.multi_chats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pending_fiat_payments update_pending_fiat_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pending_fiat_updated_at BEFORE UPDATE ON public.pending_fiat_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: smart_account_exports update_smart_account_exports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_smart_account_exports_updated_at BEFORE UPDATE ON public.smart_account_exports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_smart_accounts update_smart_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_smart_accounts_updated_at BEFORE UPDATE ON public.user_smart_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_contexts update_user_contexts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_contexts_updated_at BEFORE UPDATE ON public.user_contexts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_billing ai_billing_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_billing
    ADD CONSTRAINT ai_billing_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: ai_billing ai_billing_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_billing
    ADD CONSTRAINT ai_billing_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: applied_training_suggestions applied_training_suggestions_training_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applied_training_suggestions
    ADD CONSTRAINT applied_training_suggestions_training_run_id_fkey FOREIGN KEY (training_run_id) REFERENCES public.training_runs(id) ON DELETE CASCADE;


--
-- Name: attachment_summaries attachment_summaries_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_summaries
    ADD CONSTRAINT attachment_summaries_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: attachment_summaries attachment_summaries_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachment_summaries
    ADD CONSTRAINT attachment_summaries_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.multi_chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_events chat_events_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_events
    ADD CONSTRAINT chat_events_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: chat_folders chat_folders_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_folders
    ADD CONSTRAINT chat_folders_parent_folder_id_fkey FOREIGN KEY (parent_folder_id) REFERENCES public.chat_folders(id) ON DELETE CASCADE;


--
-- Name: chat_folders chat_folders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_folders
    ADD CONSTRAINT chat_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_invites chat_invites_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_invites
    ADD CONSTRAINT chat_invites_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_reports chat_reports_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_reports
    ADD CONSTRAINT chat_reports_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_summaries chat_summaries_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_summaries
    ADD CONSTRAINT chat_summaries_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: chat_summaries chat_summaries_covers_from_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_summaries
    ADD CONSTRAINT chat_summaries_covers_from_message_id_fkey FOREIGN KEY (covers_from_message_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_summaries chat_summaries_covers_to_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_summaries
    ADD CONSTRAINT chat_summaries_covers_to_message_id_fkey FOREIGN KEY (covers_to_message_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_transaction_state chat_transaction_state_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_transaction_state
    ADD CONSTRAINT chat_transaction_state_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: chat_transaction_state chat_transaction_state_last_updated_by_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_transaction_state
    ADD CONSTRAINT chat_transaction_state_last_updated_by_message_id_fkey FOREIGN KEY (last_updated_by_message_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: context_usage_log context_usage_log_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_usage_log
    ADD CONSTRAINT context_usage_log_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: context_usage_log context_usage_log_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_usage_log
    ADD CONSTRAINT context_usage_log_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: corrections corrections_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: corrections corrections_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: created_project_chains created_project_chains_created_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_project_chains
    ADD CONSTRAINT created_project_chains_created_project_id_fkey FOREIGN KEY (created_project_id) REFERENCES public.created_projects(id) ON DELETE CASCADE;


--
-- Name: created_projects created_projects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_projects
    ADD CONSTRAINT created_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: created_revnet_stages created_revnet_stages_created_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.created_revnet_stages
    ADD CONSTRAINT created_revnet_stages_created_project_id_fkey FOREIGN KEY (created_project_id) REFERENCES public.created_projects(id) ON DELETE CASCADE;


--
-- Name: events events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: fiat_payment_disputes fiat_payment_disputes_pending_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiat_payment_disputes
    ADD CONSTRAINT fiat_payment_disputes_pending_payment_id_fkey FOREIGN KEY (pending_payment_id) REFERENCES public.pending_fiat_payments(id);


--
-- Name: juice_balances juice_balances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_balances
    ADD CONSTRAINT juice_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: juice_cash_outs juice_cash_outs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_cash_outs
    ADD CONSTRAINT juice_cash_outs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: juice_purchases juice_purchases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_purchases
    ADD CONSTRAINT juice_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: juice_spends juice_spends_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juice_spends
    ADD CONSTRAINT juice_spends_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: juicy_feedback juicy_feedback_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_feedback
    ADD CONSTRAINT juicy_feedback_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: juicy_feedback juicy_feedback_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_feedback
    ADD CONSTRAINT juicy_feedback_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: juicy_feedback juicy_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.juicy_feedback
    ADD CONSTRAINT juicy_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: multi_chat_invites multi_chat_invites_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_invites
    ADD CONSTRAINT multi_chat_invites_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: multi_chat_keys multi_chat_keys_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_keys
    ADD CONSTRAINT multi_chat_keys_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: multi_chat_members multi_chat_members_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_members
    ADD CONSTRAINT multi_chat_members_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: multi_chat_members multi_chat_members_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_members
    ADD CONSTRAINT multi_chat_members_member_user_id_fkey FOREIGN KEY (member_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: multi_chat_messages multi_chat_messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_messages
    ADD CONSTRAINT multi_chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.multi_chats(id) ON DELETE CASCADE;


--
-- Name: multi_chat_messages multi_chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_messages
    ADD CONSTRAINT multi_chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: multi_chat_messages multi_chat_messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chat_messages
    ADD CONSTRAINT multi_chat_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: multi_chats multi_chats_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chats
    ADD CONSTRAINT multi_chats_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.chat_folders(id) ON DELETE SET NULL;


--
-- Name: multi_chats multi_chats_founder_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chats
    ADD CONSTRAINT multi_chats_founder_user_id_fkey FOREIGN KEY (founder_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: multi_chats multi_chats_last_summarized_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_chats
    ADD CONSTRAINT multi_chats_last_summarized_message_id_fkey FOREIGN KEY (last_summarized_message_id) REFERENCES public.multi_chat_messages(id) ON DELETE SET NULL;


--
-- Name: oauth_connections oauth_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_connections
    ADD CONSTRAINT oauth_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: passkey_challenges passkey_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_challenges
    ADD CONSTRAINT passkey_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: passkey_credentials passkey_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_credentials
    ADD CONSTRAINT passkey_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: passkey_wallets passkey_wallets_wallet_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_wallets
    ADD CONSTRAINT passkey_wallets_wallet_session_id_fkey FOREIGN KEY (wallet_session_id) REFERENCES public.wallet_sessions(id) ON DELETE SET NULL;


--
-- Name: payment_executions payment_executions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_executions
    ADD CONSTRAINT payment_executions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pending_fiat_payments pending_fiat_payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_fiat_payments
    ADD CONSTRAINT pending_fiat_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pending_transfers pending_transfers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reserve_transactions reserve_transactions_related_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserve_transactions
    ADD CONSTRAINT reserve_transactions_related_payment_id_fkey FOREIGN KEY (related_payment_id) REFERENCES public.payment_executions(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: smart_account_balances smart_account_balances_smart_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_balances
    ADD CONSTRAINT smart_account_balances_smart_account_id_fkey FOREIGN KEY (smart_account_id) REFERENCES public.user_smart_accounts(id) ON DELETE CASCADE;


--
-- Name: smart_account_exports smart_account_exports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_exports
    ADD CONSTRAINT smart_account_exports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: smart_account_project_roles smart_account_project_roles_smart_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_project_roles
    ADD CONSTRAINT smart_account_project_roles_smart_account_id_fkey FOREIGN KEY (smart_account_id) REFERENCES public.user_smart_accounts(id) ON DELETE CASCADE;


--
-- Name: smart_account_withdrawals smart_account_withdrawals_smart_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_account_withdrawals
    ADD CONSTRAINT smart_account_withdrawals_smart_account_id_fkey FOREIGN KEY (smart_account_id) REFERENCES public.user_smart_accounts(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_contexts user_contexts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contexts
    ADD CONSTRAINT user_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_keypairs user_keypairs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_keypairs
    ADD CONSTRAINT user_keypairs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_regions user_regions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_regions
    ADD CONSTRAINT user_regions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_smart_accounts user_smart_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_smart_accounts
    ADD CONSTRAINT user_smart_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ZQp1eMK72nDPIc6wL3gF0hR0tOdEtQegTtQtKJsleno5x7Wemg4WG4ILje4cspw

