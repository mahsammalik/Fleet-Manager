--
-- PostgreSQL database cluster dump
--

-- Started on 2026-05-01 20:40:50

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE fleetadmin;
ALTER ROLE fleetadmin WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE postgres;
ALTER ROLE postgres WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;

--
-- User Configurations
--






--
-- Databases
--

--
-- Database "template1" dump
--

\connect template1

--
-- PostgreSQL database dump
--

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 15.3

-- Started on 2026-05-01 20:40:51

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
-- TOC entry 4 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- TOC entry 3310 (class 0 OID 0)
-- Dependencies: 4
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


-- Completed on 2026-05-01 20:40:54

--
-- PostgreSQL database dump complete
--

--
-- Database "fleetmanager" dump
--

--
-- PostgreSQL database dump
--

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 15.3

-- Started on 2026-05-01 20:40:54

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
-- TOC entry 3643 (class 1262 OID 16384)
-- Name: fleetmanager; Type: DATABASE; Schema: -; Owner: postgres
--

CREATE DATABASE fleetmanager WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'en_US.UTF-8';


ALTER DATABASE fleetmanager OWNER TO postgres;

\connect fleetmanager

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
-- TOC entry 5 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- TOC entry 2 (class 3079 OID 16589)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 3646 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- TOC entry 251 (class 1255 OID 24745)
-- Name: earnings_records_match_vehicle_rental(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.earnings_records_match_vehicle_rental() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  rid UUID;
  v_total NUMERIC(12, 2);
  v_vehicle_id UUID;
  daily_rent NUMERIC(10, 2);
BEGIN
  IF NEW.driver_id IS NULL OR NEW.trip_date IS NULL THEN
    NEW.vehicle_rental_id := NULL;
    NEW.vehicle_rental_fee := NULL;
    RETURN NEW;
  END IF;

  SELECT v.id, v.total_rent_amount, v.vehicle_id
  INTO rid, v_total, v_vehicle_id
  FROM vehicle_rentals v
  INNER JOIN drivers d ON d.id = NEW.driver_id AND d.organization_id = v.organization_id
  WHERE v.driver_id = NEW.driver_id
    AND NEW.trip_date >= v.rental_start_date
    AND NEW.trip_date <= v.rental_end_date
    AND v.status IN ('active', 'completed')
  ORDER BY v.rental_start_date DESC, v.id
  LIMIT 1;

  IF rid IS NULL THEN
    NEW.vehicle_rental_id := NULL;
    NEW.vehicle_rental_fee := NULL;
    RETURN NEW;
  END IF;

  NEW.vehicle_rental_id := rid;

  IF v_total IS NOT NULL THEN
    NEW.vehicle_rental_fee := ROUND(v_total::numeric, 2);
  ELSE
    SELECT ve.daily_rent INTO daily_rent FROM vehicles ve WHERE ve.id = v_vehicle_id;
    IF daily_rent IS NULL THEN
      NEW.vehicle_rental_fee := NULL;
    ELSE
      NEW.vehicle_rental_fee := ROUND(daily_rent::numeric, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.earnings_records_match_vehicle_rental() OWNER TO postgres;

--
-- TOC entry 252 (class 1255 OID 24748)
-- Name: refresh_driver_payout_vehicle_fees(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_driver_payout_vehicle_fees(p_org_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  n INT;
BEGIN
  UPDATE driver_payouts dp
  SET vehicle_rental_fee = COALESCE(agg.s, 0)
  FROM (
    SELECT dp2.id,
           COALESCE((
             SELECT SUM(sub.mx)
             FROM (
               SELECT er.vehicle_rental_id,
                      MAX(er.vehicle_rental_fee) AS mx
               FROM earnings_records er
               INNER JOIN earnings_imports ei ON ei.id = er.import_id
               WHERE er.driver_id = dp2.driver_id
                 AND ei.organization_id = dp2.organization_id
                 AND ei.week_start = dp2.payment_period_start
                 AND ei.week_end = dp2.payment_period_end
                 AND er.vehicle_rental_id IS NOT NULL
                 AND er.vehicle_rental_fee IS NOT NULL
               GROUP BY er.vehicle_rental_id
             ) sub
           ), 0) AS s
    FROM driver_payouts dp2
    WHERE dp2.organization_id = p_org_id
  ) agg
  WHERE dp.id = agg.id AND dp.organization_id = p_org_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;


ALTER FUNCTION public.refresh_driver_payout_vehicle_fees(p_org_id uuid) OWNER TO postgres;

--
-- TOC entry 253 (class 1255 OID 24735)
-- Name: trg_enforce_driver_payout_after_cash(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_enforce_driver_payout_after_cash() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  transfer_base numeric;
  payout numeric;
BEGIN
  transfer_base := COALESCE(
    NEW.total_transfer_earnings,
    NEW.net_earnings,
    COALESCE(NEW.gross_earnings, 0) - COALESCE(NEW.platform_fee, 0),
    NEW.gross_earnings,
    0
  );

  payout := ROUND(
    (
      transfer_base
      - COALESCE(NEW.transfer_commission, 0)
      - ABS(COALESCE(NEW.cash_commission, 0))
    )::numeric,
    2
  );

  NEW.driver_payout := payout;
  NEW.net_earnings := payout;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.trg_enforce_driver_payout_after_cash() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 227 (class 1259 OID 24605)
-- Name: backup_017_driver_payments_cash_periods; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.backup_017_driver_payments_cash_periods (
    id uuid,
    organization_id uuid,
    driver_id uuid,
    payment_period_start date,
    payment_period_end date,
    total_gross_earnings numeric(12,2),
    total_platform_fees numeric(10,2),
    total_net_earnings numeric(12,2),
    company_commission numeric(10,2),
    bonuses numeric(10,2),
    penalties numeric(10,2),
    adjustments numeric(10,2),
    net_driver_payout numeric(10,2),
    payment_status character varying(50),
    payment_date date,
    payment_method character varying(50),
    transaction_ref character varying(100),
    notes text,
    approved_by uuid,
    approved_at timestamp without time zone,
    created_at timestamp without time zone,
    total_daily_cash numeric(12,2)
);


ALTER TABLE public.backup_017_driver_payments_cash_periods OWNER TO postgres;

--
-- TOC entry 213 (class 1259 OID 16661)
-- Name: driver_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.driver_documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    driver_id uuid,
    organization_id uuid,
    document_type character varying(50) NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_size integer,
    mime_type character varying(100),
    expiry_date date,
    is_verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp without time zone,
    uploaded_by uuid,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT driver_documents_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['id_card'::character varying, 'drivers_license'::character varying, 'contract'::character varying, 'insurance'::character varying, 'vehicle_permit'::character varying, 'other'::character varying])::text[])))
);


ALTER TABLE public.driver_documents OWNER TO postgres;

--
-- TOC entry 217 (class 1259 OID 16756)
-- Name: driver_payouts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.driver_payouts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    driver_id uuid,
    payment_period_start date NOT NULL,
    payment_period_end date NOT NULL,
    total_gross_earnings numeric(12,2),
    total_platform_fees numeric(10,2),
    total_net_earnings numeric(12,2),
    company_commission numeric(10,2),
    bonuses numeric(10,2) DEFAULT 0,
    penalties numeric(10,2) DEFAULT 0,
    adjustments numeric(10,2) DEFAULT 0,
    net_driver_payout numeric(10,2),
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    payment_date date,
    payment_method character varying(50),
    transaction_ref character varying(100),
    notes text,
    approved_by uuid,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total_daily_cash numeric(12,2) DEFAULT 0,
    vehicle_rental_id uuid,
    vehicle_rental_fee numeric(12,2) DEFAULT 0,
    platform_id character varying(255),
    raw_net_amount numeric(12,2) DEFAULT 0,
    debt_amount numeric(12,2) DEFAULT 0,
    debt_applied_amount numeric(12,2) DEFAULT 0,
    remaining_debt_amount numeric(12,2) DEFAULT 0,
    CONSTRAINT driver_payouts_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'approved'::character varying, 'paid'::character varying, 'failed'::character varying, 'hold'::character varying, 'debt'::character varying])::text[])))
);


ALTER TABLE public.driver_payouts OWNER TO postgres;

--
-- TOC entry 212 (class 1259 OID 16632)
-- Name: drivers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.drivers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    user_id uuid,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255),
    phone character varying(20) NOT NULL,
    date_of_birth date,
    address text,
    license_number character varying(50),
    license_expiry date,
    license_class character varying(20),
    hire_date date,
    employment_status character varying(50) DEFAULT 'active'::character varying,
    commission_rate numeric(5,2) DEFAULT 20.00,
    base_commission_rate numeric(5,2) DEFAULT 20.00,
    commission_type character varying(50) DEFAULT 'percentage'::character varying,
    fixed_commission_amount numeric(10,2) DEFAULT 0.00,
    minimum_commission numeric(10,2) DEFAULT 0.00,
    uber_driver_id character varying(100),
    bolt_driver_id character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_deleted boolean DEFAULT false,
    deleted_at timestamp without time zone,
    deleted_by uuid,
    glovo_courier_id character varying(100),
    bolt_courier_id character varying(100),
    current_vehicle_id uuid,
    profile_photo_url character varying(500),
    profile_photo_updated_at timestamp without time zone,
    wolt_courier_id character varying(100),
    wolt_courier_verified boolean DEFAULT false,
    wolt_courier_verified_at timestamp without time zone,
    CONSTRAINT drivers_commission_type_check CHECK (((commission_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed_amount'::character varying, 'hybrid'::character varying])::text[]))),
    CONSTRAINT drivers_employment_status_check CHECK (((employment_status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'terminated'::character varying])::text[])))
);


ALTER TABLE public.drivers OWNER TO postgres;

--
-- TOC entry 210 (class 1259 OID 16600)
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organizations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(20),
    address text,
    logo_url character varying(500),
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.organizations OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 24749)
-- Name: dashboard_stats; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.dashboard_stats AS
 SELECT ( SELECT count(*) AS count
           FROM public.drivers
          WHERE (drivers.organization_id = ( SELECT organizations.id
                   FROM public.organizations
                 LIMIT 1))) AS total_drivers,
    ( SELECT count(*) AS count
           FROM public.drivers
          WHERE ((drivers.organization_id = ( SELECT organizations.id
                   FROM public.organizations
                 LIMIT 1)) AND ((drivers.employment_status)::text = 'active'::text))) AS active_drivers,
    ( SELECT count(*) AS count
           FROM public.driver_documents
          WHERE ((driver_documents.organization_id = ( SELECT organizations.id
                   FROM public.organizations
                 LIMIT 1)) AND (driver_documents.is_verified = false))) AS pending_documents,
    ( SELECT count(*) AS count
           FROM public.driver_documents
          WHERE ((driver_documents.organization_id = ( SELECT organizations.id
                   FROM public.organizations
                 LIMIT 1)) AND (driver_documents.expiry_date < CURRENT_DATE))) AS expired_documents,
    ( SELECT sum(drivers.commission_rate) AS sum
           FROM public.drivers
          WHERE (drivers.organization_id = ( SELECT organizations.id
                   FROM public.organizations
                 LIMIT 1))) AS total_commission_rate,
    ( SELECT count(*) AS count
           FROM public.driver_payouts
          WHERE ((driver_payouts.organization_id = ( SELECT organizations.id
                   FROM public.organizations
                 LIMIT 1)) AND ((driver_payouts.payment_status)::text = 'pending'::text))) AS pending_payments;


ALTER TABLE public.dashboard_stats OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 17097)
-- Name: deposit_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deposit_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rental_id uuid,
    organization_id uuid,
    transaction_type character varying(50) NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    payment_status character varying(50) DEFAULT 'completed'::character varying,
    transaction_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT deposit_transactions_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT deposit_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['payment'::character varying, 'refund'::character varying, 'deduction'::character varying])::text[])))
);


ALTER TABLE public.deposit_transactions OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16808)
-- Name: document_verification_stats; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.document_verification_stats AS
 SELECT driver_documents.document_type,
    count(*) AS total,
    sum(
        CASE
            WHEN (driver_documents.is_verified = true) THEN 1
            ELSE 0
        END) AS verified,
    sum(
        CASE
            WHEN (driver_documents.is_verified = false) THEN 1
            ELSE 0
        END) AS pending
   FROM public.driver_documents
  WHERE (driver_documents.organization_id = ( SELECT organizations.id
           FROM public.organizations
         LIMIT 1))
  GROUP BY driver_documents.document_type;


ALTER TABLE public.document_verification_stats OWNER TO postgres;

--
-- TOC entry 214 (class 1259 OID 16700)
-- Name: driver_activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.driver_activities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    driver_id uuid,
    activity_type character varying(50) NOT NULL,
    activity_description text,
    performed_by uuid,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.driver_activities OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16804)
-- Name: driver_status_distribution; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.driver_status_distribution AS
 SELECT drivers.employment_status,
    count(*) AS count
   FROM public.drivers
  WHERE (drivers.organization_id = ( SELECT organizations.id
           FROM public.organizations
         LIMIT 1))
  GROUP BY drivers.employment_status;


ALTER TABLE public.driver_status_distribution OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 24583)
-- Name: earnings_import_staging; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.earnings_import_staging (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    import_id uuid NOT NULL,
    row_index integer NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.earnings_import_staging OWNER TO postgres;

--
-- TOC entry 215 (class 1259 OID 16721)
-- Name: earnings_imports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.earnings_imports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    file_name character varying(255),
    import_date date NOT NULL,
    week_start date NOT NULL,
    week_end date NOT NULL,
    platform character varying(50) NOT NULL,
    total_gross numeric(12,2),
    total_trips integer,
    record_count integer,
    imported_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'completed'::character varying NOT NULL,
    detection_meta jsonb,
    CONSTRAINT earnings_imports_platform_check CHECK (((platform)::text = ANY ((ARRAY['uber'::character varying, 'bolt'::character varying, 'glovo'::character varying, 'bolt_courier'::character varying, 'wolt_courier'::character varying])::text[]))),
    CONSTRAINT earnings_imports_status_check CHECK (((status)::text = ANY ((ARRAY['preview'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


ALTER TABLE public.earnings_imports OWNER TO postgres;

--
-- TOC entry 216 (class 1259 OID 16739)
-- Name: earnings_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.earnings_records (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    import_id uuid,
    driver_id uuid,
    platform character varying(50) NOT NULL,
    trip_date date NOT NULL,
    trip_count integer,
    gross_earnings numeric(10,2),
    platform_fee numeric(10,2),
    net_earnings numeric(10,2),
    company_commission numeric(10,2),
    driver_payout numeric(10,2),
    commission_type character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total_transfer_earnings numeric(10,2),
    daily_cash numeric(10,2),
    transfer_commission numeric(10,2),
    cash_commission numeric(10,2),
    account_opening_fee numeric(10,2),
    vehicle_rental_id uuid,
    vehicle_rental_fee numeric(10,2),
    has_cash_commission boolean GENERATED ALWAYS AS ((COALESCE(cash_commission, (0)::numeric) < (0)::numeric)) STORED,
    driver_payout_after_cash numeric(10,2) GENERATED ALWAYS AS (round(((COALESCE(total_transfer_earnings, net_earnings, (COALESCE(gross_earnings, (0)::numeric) - COALESCE(platform_fee, (0)::numeric)), gross_earnings, (0)::numeric) - COALESCE(transfer_commission, (0)::numeric)) - abs(COALESCE(cash_commission, (0)::numeric))), 2)) STORED
);


ALTER TABLE public.earnings_records OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16813)
-- Name: monthly_earnings; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.monthly_earnings AS
 SELECT date_trunc('month'::text, er.created_at) AS month,
    sum(er.gross_earnings) AS total_earnings,
    sum(er.platform_fee) AS total_platform_fees,
    sum(er.net_earnings) AS total_net_earnings,
    sum(er.company_commission) AS total_commission,
    sum(er.driver_payout) AS total_driver_payout
   FROM (public.earnings_records er
     JOIN public.drivers d ON ((er.driver_id = d.id)))
  WHERE (d.organization_id = ( SELECT organizations.id
           FROM public.organizations
         LIMIT 1))
  GROUP BY (date_trunc('month'::text, er.created_at))
  ORDER BY (date_trunc('month'::text, er.created_at)) DESC;


ALTER TABLE public.monthly_earnings OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 24795)
-- Name: payout_adjustments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payout_adjustments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    payout_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    reason text,
    adjustment_type character varying(32) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT payout_adjustments_adjustment_type_check CHECK (((adjustment_type)::text = ANY ((ARRAY['adjust'::character varying, 'forgive'::character varying, 'cash_received'::character varying, 'carry_forward'::character varying])::text[])))
);


ALTER TABLE public.payout_adjustments OWNER TO postgres;

--
-- TOC entry 211 (class 1259 OID 16613)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone character varying(20),
    role character varying(50) NOT NULL,
    avatar_url character varying(500),
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'accountant'::character varying, 'driver'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 17018)
-- Name: vehicle_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vehicle_id uuid,
    organization_id uuid,
    document_type character varying(50) NOT NULL,
    document_number character varying(100),
    file_name character varying(255),
    file_path character varying(500),
    file_size integer,
    expiry_date date,
    issue_date date,
    is_verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp without time zone,
    notes text,
    uploaded_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.vehicle_documents OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16991)
-- Name: vehicle_maintenance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_maintenance (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vehicle_id uuid,
    maintenance_type character varying(50) NOT NULL,
    description text,
    cost numeric(10,2),
    scheduled_date date,
    completed_date date,
    status character varying(50) DEFAULT 'pending'::character varying,
    mechanic_name character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vehicle_maintenance_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.vehicle_maintenance OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16950)
-- Name: vehicle_rentals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_rentals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vehicle_id uuid,
    driver_id uuid,
    organization_id uuid,
    rental_start_date date NOT NULL,
    rental_end_date date NOT NULL,
    rental_type character varying(50) DEFAULT 'daily'::character varying,
    total_rent_amount numeric(10,2),
    deposit_amount numeric(10,2) DEFAULT 0.00,
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    payment_date date,
    payment_method character varying(50),
    payment_reference character varying(100),
    status character varying(50) DEFAULT 'active'::character varying,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deposit_status character varying(50) DEFAULT 'pending'::character varying,
    deposit_paid_at timestamp without time zone,
    deposit_refunded_at timestamp without time zone,
    deposit_deduction_amount numeric(10,2) DEFAULT 0.00,
    deposit_deduction_reason text,
    CONSTRAINT vehicle_rentals_deposit_status_check CHECK (((deposit_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'refunded'::character varying, 'partial'::character varying])::text[]))),
    CONSTRAINT vehicle_rentals_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'partial'::character varying, 'overdue'::character varying])::text[]))),
    CONSTRAINT vehicle_rentals_rental_type_check CHECK (((rental_type)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[]))),
    CONSTRAINT vehicle_rentals_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'overdue'::character varying])::text[])))
);


ALTER TABLE public.vehicle_rentals OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16919)
-- Name: vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    vehicle_type character varying(50) NOT NULL,
    make character varying(100) NOT NULL,
    model character varying(100) NOT NULL,
    year integer,
    color character varying(50),
    license_plate character varying(20) NOT NULL,
    vin character varying(100),
    fuel_type character varying(50),
    transmission character varying(50),
    seating_capacity integer,
    daily_rent numeric(10,2) DEFAULT 0.00,
    weekly_rent numeric(10,2) DEFAULT 0.00,
    monthly_rent numeric(10,2) DEFAULT 0.00,
    insurance_expiry date,
    registration_expiry date,
    status character varying(50) DEFAULT 'available'::character varying,
    current_driver_id uuid,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vehicles_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'rented'::character varying, 'maintenance'::character varying, 'sold'::character varying, 'scrapped'::character varying])::text[])))
);


ALTER TABLE public.vehicles OWNER TO postgres;

--
-- TOC entry 3636 (class 0 OID 24605)
-- Dependencies: 227
-- Data for Name: backup_017_driver_payments_cash_periods; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.backup_017_driver_payments_cash_periods (id, organization_id, driver_id, payment_period_start, payment_period_end, total_gross_earnings, total_platform_fees, total_net_earnings, company_commission, bonuses, penalties, adjustments, net_driver_payout, payment_status, payment_date, payment_method, transaction_ref, notes, approved_by, approved_at, created_at, total_daily_cash) FROM stdin;
\.


--
-- TOC entry 3634 (class 0 OID 17097)
-- Dependencies: 225
-- Data for Name: deposit_transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deposit_transactions (id, rental_id, organization_id, transaction_type, amount, payment_method, payment_status, transaction_date, notes, created_by, created_at) FROM stdin;
d2aa2978-bdf4-4197-9f51-30d2e04fb7e4	e3ac8ebb-0cb8-49b2-88ea-c2687f026e97	b056757f-95bf-42ea-9c7e-3f75e459b726	payment	200.00	cash	completed	2026-04-27 02:46:05.347284	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-04-27 02:46:05.347284
\.


--
-- TOC entry 3626 (class 0 OID 16700)
-- Dependencies: 214
-- Data for Name: driver_activities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.driver_activities (id, driver_id, activity_type, activity_description, performed_by, old_values, new_values, created_at) FROM stdin;
773fd476-78c4-4646-918e-8ea28faf8a6c	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:03:31.794437
b8fb1494-b5ca-4214-ae34-0049f7486640	8081d690-38de-4fb9-bd34-cdc176c35865	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:04:03.046207
3493ab35-40c0-495f-bd29-2fc40eb01b85	923fc82e-4730-47cb-ba9e-a8af9e9251cb	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:04:37.45747
097e5e0c-6762-48d5-b781-005d6c682b53	3ab8471a-bafe-432e-acd3-76f09b88f3cf	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:05:20.240632
1d640bc2-68d9-467d-9b3a-d5286b4254b2	11086bf8-3977-4f3d-8116-8c006cef839a	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:06:18.429477
6baa0c0d-8125-42aa-8856-8e4a1fc10047	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:06:55.186082
5ee0c58a-8297-4d12-96be-a7518bb682ae	89dd665f-5fac-40a3-8df6-667e78d80ac7	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:07:28.00982
d19b2cdb-936b-44ea-95e0-ac8a7b1fa834	3e99e189-5c59-4748-af33-132778fe46d9	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:08:20.814238
8bd735bd-5796-4f43-8ef8-a2d750c90180	4d7d391b-bf01-488f-b001-80cb7057b696	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 11:09:31.550231
6302e9cd-86b1-4ba6-a450-fc97eced7e1b	eb5d629c-bf85-494a-beaf-6e66885b6bad	deposit_not_required	No deposit requested for this rental	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "7c5c84aa-eed5-4775-b5be-62ae75e44d77", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 0, "fallback_rate_amount": 415}	2026-04-15 12:17:12.923379
e579f976-80b2-4561-8a18-f78dc19b5e05	9c237234-03d6-4923-8069-fab63f995c70	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-15 12:37:42.310611
27b7746d-b1b5-46e4-812a-2b4c69d4a40b	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-16 02:16:07.348341
2cc0feab-fe40-4de6-9fb1-d9b8847ec8ac	eb5d629c-bf85-494a-beaf-6e66885b6bad	deposit_not_required	No deposit requested for this rental	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "beb0c530-1db5-4910-9d0f-40ad9fb4fe07", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 0, "fallback_rate_amount": 315}	2026-04-16 02:30:34.597175
6041db10-e9a7-47c7-8a12-83c7646a2290	eb5d629c-bf85-494a-beaf-6e66885b6bad	deposit_not_required	No deposit requested for this rental	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "a670da98-25d6-43de-b797-d6f3caef4228", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 0, "fallback_rate_amount": 315}	2026-04-16 02:40:04.862579
6e2df06b-f78e-4012-8ab7-59ae7567dce1	eb5d629c-bf85-494a-beaf-6e66885b6bad	deposit_not_required	No deposit requested for this rental	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "ae4f8ba2-8df8-4421-8c1d-7b363af213df", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 0, "fallback_rate_amount": 315}	2026-04-16 02:55:42.84432
996ed211-4df3-4213-8af9-74b0b7f23777	eb5d629c-bf85-494a-beaf-6e66885b6bad	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-16 18:13:51.311589
201d4e37-fca2-4374-b5bf-ba59d3e48162	fedc175f-938e-4022-a4d8-463633357218	document_upload	Document uploaded: FacturaF10233-PRESENCE_CONCLUSION_S.R.L..pdf (drivers_license)	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"file_name": "FacturaF10233-PRESENCE_CONCLUSION_S.R.L..pdf", "document_type": "drivers_license"}	2026-04-17 14:45:41.335206
a71928c9-6f81-4227-a040-959275f82fd3	eb5d629c-bf85-494a-beaf-6e66885b6bad	deposit_not_required	No deposit requested for this rental	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "2384544a-74ea-4fe7-beef-8e860b5c1868", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 0, "fallback_rate_amount": 315}	2026-04-18 13:36:37.755457
b196a832-7ac5-47c6-8199-8c7d4a538d24	0b126711-4db1-4eba-9255-0ec8719d2acb	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-21 15:00:11.159559
6d39b47a-3ab2-4c05-9b3e-d0465b15484e	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-21 15:40:35.087769
c6fa5bae-2908-447c-9f28-f3318b51ea5a	89dd665f-5fac-40a3-8df6-667e78d80ac7	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-21 15:43:13.375083
3c805af6-a4a1-47aa-a328-409eb2033b11	eed86734-204b-41f1-9d0e-bdf82d71a7f0	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-21 19:29:52.299031
0fbe927d-a640-4383-b879-1eed82379bfb	eed86734-204b-41f1-9d0e-bdf82d71a7f0	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-21 19:46:56.487416
cd9496c8-ecfc-4f0a-b0f1-689ad0066334	0b126711-4db1-4eba-9255-0ec8719d2acb	driver_delete	Driver soft deleted	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"is_deleted": true, "employment_status": "terminated"}	2026-04-21 19:49:15.093822
7c7821d2-c049-4bfd-80b3-db4ada2c23b3	9b926250-adf6-41f7-ae0a-1ccda760461f	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-24 20:03:59.910786
7ff450da-3664-4ac5-897f-8dc3e2582e08	49004ab2-6583-4cad-8ba6-a74178f458db	deposit_due	Deposit of RON 200.00 due for vehicle rental	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "e3ac8ebb-0cb8-49b2-88ea-c2687f026e97", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 200}	2026-04-27 02:45:21.192241
b4a67eab-fdd7-413d-beeb-75f672e864c1	49004ab2-6583-4cad-8ba6-a74178f458db	deposit_paid	Deposit of RON 200.00 marked as paid	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	{"rental_id": "e3ac8ebb-0cb8-49b2-88ea-c2687f026e97", "vehicle_id": "815ae606-ec05-4e41-b49a-39db1a9400bb", "deposit_amount": 200}	2026-04-27 02:46:05.36755
852d71ae-948c-4ddf-859f-4e0845f03b81	89dd665f-5fac-40a3-8df6-667e78d80ac7	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-27 14:02:42.305406
fc4624c8-90fa-40a4-a695-1baa26b4187a	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-27 14:28:06.68522
c186f0ba-1215-43e3-9713-045ab852f69d	eed86734-204b-41f1-9d0e-bdf82d71a7f0	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-27 14:30:15.455576
35a283e9-978b-4497-8288-06d3ff2619d7	923fc82e-4730-47cb-ba9e-a8af9e9251cb	profile_update	Driver profile updated	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	\N	2026-04-27 15:46:52.906857
\.


--
-- TOC entry 3625 (class 0 OID 16661)
-- Dependencies: 213
-- Data for Name: driver_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.driver_documents (id, driver_id, organization_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, is_verified, verified_by, verified_at, uploaded_by, notes, created_at) FROM stdin;
2ea8578d-0455-4633-b437-161b07ddc075	fedc175f-938e-4022-a4d8-463633357218	b056757f-95bf-42ea-9c7e-3f75e459b726	drivers_license	FacturaF10233-PRESENCE_CONCLUSION_S.R.L..pdf	uploads/driver-documents/fedc175f-938e-4022-a4d8-463633357218/1776419140949-FacturaF10233-PRESENCE_CONCLUSION_S.R.L..pdf	59709	application/pdf	\N	f	\N	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	\N	2026-04-17 14:45:41.306404
\.


--
-- TOC entry 3629 (class 0 OID 16756)
-- Dependencies: 217
-- Data for Name: driver_payouts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.driver_payouts (id, organization_id, driver_id, payment_period_start, payment_period_end, total_gross_earnings, total_platform_fees, total_net_earnings, company_commission, bonuses, penalties, adjustments, net_driver_payout, payment_status, payment_date, payment_method, transaction_ref, notes, approved_by, approved_at, created_at, total_daily_cash, vehicle_rental_id, vehicle_rental_fee, platform_id, raw_net_amount, debt_amount, debt_applied_amount, remaining_debt_amount) FROM stdin;
509a7cb2-03e6-4b14-8c16-455a8619a17a	b056757f-95bf-42ea-9c7e-3f75e459b726	5fee9303-c9e0-4c93-8d0b-e80daf790f69	2026-04-06	2026-04-12	2430.96	-36.46	2129.23	184.47	0.00	0.00	0.00	2129.23	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-586.27	\N	0.00	4375552	2129.23	0.00	0.00	0.00
7b0e949f-2186-4e22-bf0c-00936f04ca0e	b056757f-95bf-42ea-9c7e-3f75e459b726	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	2026-04-06	2026-04-12	620.93	-9.31	525.62	28.87	0.00	0.00	0.00	525.62	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-332.23	\N	0.00	3802716	525.62	0.00	0.00	0.00
111110e6-e5bf-4129-9ddb-418426c7cd94	b056757f-95bf-42ea-9c7e-3f75e459b726	3ab8471a-bafe-432e-acd3-76f09b88f3cf	2026-04-06	2026-04-12	599.43	-8.99	527.72	48.17	0.00	0.00	0.00	527.72	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-117.67	\N	0.00	3777223	527.72	0.00	0.00	0.00
442f0226-b976-48a8-b98e-593e3fdf2957	b056757f-95bf-42ea-9c7e-3f75e459b726	89dd665f-5fac-40a3-8df6-667e78d80ac7	2026-04-06	2026-04-12	772.63	-11.59	670.21	52.10	0.00	0.00	0.00	670.21	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-251.62	\N	0.00	4340056	670.21	0.00	0.00	0.00
6bc2a009-99dd-452a-85f4-a88730c7a2d1	b056757f-95bf-42ea-9c7e-3f75e459b726	40b8b06a-aeef-445d-8de5-549939e33f17	2026-04-06	2026-04-12	867.80	-13.02	770.92	76.68	0.00	0.00	0.00	770.92	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-101.02	\N	0.00	4375550	770.92	0.00	0.00	0.00
04be970f-f7f1-44f2-871a-7c7080b3b005	b056757f-95bf-42ea-9c7e-3f75e459b726	277d19f6-4a38-4909-9ddb-d1e83de5e014	2026-04-06	2026-04-12	1115.27	-16.73	997.79	105.58	0.00	0.00	0.00	997.79	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-59.53	\N	0.00	4466674	997.79	0.00	0.00	0.00
5877833f-ae03-4cff-a388-4008ff8c5feb	b056757f-95bf-42ea-9c7e-3f75e459b726	11086bf8-3977-4f3d-8116-8c006cef839a	2026-04-06	2026-04-12	1873.38	-28.10	1686.04	187.34	0.00	0.00	0.00	1686.04	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	3820899	1686.04	0.00	0.00	0.00
d7fe03f2-3858-4f81-9f32-6da4d9210105	b056757f-95bf-42ea-9c7e-3f75e459b726	dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	2026-04-06	2026-04-12	566.32	-8.49	500.40	47.34	0.00	0.00	0.00	500.40	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-92.87	\N	0.00	4505047	500.40	0.00	0.00	0.00
6c4b71e2-2cfb-4193-b86f-718a15fcbd6f	b056757f-95bf-42ea-9c7e-3f75e459b726	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	2026-04-06	2026-04-12	3388.47	-50.83	3049.62	338.85	0.00	0.00	0.00	3049.62	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	4505090	3049.62	0.00	0.00	0.00
01c855a9-f3a9-4fbf-b6c6-09942b4f1055	b056757f-95bf-42ea-9c7e-3f75e459b726	64d26978-b842-4b70-95b9-8cbdcc08e2f5	2026-04-06	2026-04-12	1047.68	-15.72	942.91	104.77	0.00	0.00	0.00	942.91	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	3776255	942.91	0.00	0.00	0.00
27e80890-f825-4d47-a0ea-75e603e234ca	b056757f-95bf-42ea-9c7e-3f75e459b726	23390533-03be-4c9e-a5e3-c84e1ecc268c	2026-04-06	2026-04-12	2314.65	-34.72	2083.18	231.47	0.00	0.00	0.00	2083.18	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	4505067	2083.18	0.00	0.00	0.00
36619fc9-efc2-4bed-b2e4-467af664d817	b056757f-95bf-42ea-9c7e-3f75e459b726	85e400cf-9b36-4ae3-ade6-13302a38d4ed	2026-04-06	2026-04-12	724.24	-10.86	617.86	38.46	0.00	0.00	0.00	617.86	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-339.59	\N	0.00	4272517	617.86	0.00	0.00	0.00
c3455752-6261-45c8-9abf-72b0e6b2d96e	b056757f-95bf-42ea-9c7e-3f75e459b726	0ca3b8ed-0d55-4bff-957e-b453a12105cc	2026-04-06	2026-04-12	13.29	-0.20	2.34	-8.29	0.00	0.00	0.00	2.34	pending	\N	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-96.16	\N	0.00	2599609	2.34	0.00	0.00	0.00
ef6c86ac-b3dc-4161-81b0-286873e63ad5	b056757f-95bf-42ea-9c7e-3f75e459b726	4d7d391b-bf01-488f-b001-80cb7057b696	2026-04-06	2026-04-12	206.08	-3.09	153.84	-11.02	0.00	0.00	0.00	153.84	pending	\N	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-316.28	\N	0.00	4422610	153.84	0.00	0.00	0.00
34c8f0c9-9411-48c0-a6c3-ed1626c57cbb	b056757f-95bf-42ea-9c7e-3f75e459b726	3e99e189-5c59-4748-af33-132778fe46d9	2026-04-06	2026-04-12	543.32	-8.15	488.99	54.33	0.00	0.00	0.00	488.99	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	4272617	488.99	0.00	0.00	0.00
345423fc-0e35-46fc-a823-8b258a472bce	b056757f-95bf-42ea-9c7e-3f75e459b726	0b126711-4db1-4eba-9255-0ec8719d2acb	2026-04-06	2026-04-12	1453.10	-21.80	1295.41	132.93	0.00	0.00	0.00	1295.41	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-123.82	\N	0.00	2828721	1295.41	0.00	0.00	0.00
7c0990d1-bc5b-4a6c-8616-6e066fcd2009	b056757f-95bf-42ea-9c7e-3f75e459b726	15cbbadf-c84d-435f-8393-30bdcca08c81	2026-04-06	2026-04-12	1368.60	-20.53	1222.45	127.57	0.00	0.00	0.00	1222.45	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-92.86	\N	0.00	4150354	1222.45	0.00	0.00	0.00
0cd2e2a4-98ac-4909-963c-1cb5efbe6730	b056757f-95bf-42ea-9c7e-3f75e459b726	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	2026-04-06	2026-04-12	796.93	-11.95	717.01	79.46	0.00	0.00	0.00	717.01	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-2.29	\N	0.00	2311096	717.01	0.00	0.00	0.00
7c11be25-9e92-4cde-8248-22f431b67db2	b056757f-95bf-42ea-9c7e-3f75e459b726	bdbdf261-cc6c-4ccc-8815-cb9787e437dc	2026-04-06	2026-04-12	1408.63	-21.13	1267.77	140.86	0.00	0.00	0.00	1267.77	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	4501478	1267.77	0.00	0.00	0.00
7682df61-53c4-4e29-8329-17a585159015	b056757f-95bf-42ea-9c7e-3f75e459b726	34ae1ec3-6f90-4898-9418-e9535c691ff2	2026-04-06	2026-04-12	691.71	-10.38	622.54	69.17	0.00	0.00	0.00	622.54	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	4494353	622.54	0.00	0.00	0.00
09e9a640-a1de-4246-8c84-dc08f11324b0	b056757f-95bf-42ea-9c7e-3f75e459b726	6c4d01f6-5972-469a-83e5-36d9e49e91cf	2026-04-06	2026-04-12	1840.33	-27.60	1644.86	172.59	0.00	0.00	0.00	1644.86	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-114.43	\N	0.00	4492811	1644.86	0.00	0.00	0.00
bf0a8496-3b3f-47b3-b0c0-0fa2bb668e7b	b056757f-95bf-42ea-9c7e-3f75e459b726	5b18e6ec-238e-484b-808e-c3d5f1b74ac8	2026-04-06	2026-04-12	1378.64	-20.68	1235.93	133.01	0.00	0.00	0.00	1235.93	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-48.51	\N	0.00	2837774	1235.93	0.00	0.00	0.00
4a7ef486-f0d8-43c5-9b76-28800ba05682	b056757f-95bf-42ea-9c7e-3f75e459b726	3f662a2e-3e89-49f8-beed-fe533d22b00e	2026-04-06	2026-04-12	474.61	-7.12	390.19	10.50	0.00	0.00	0.00	390.19	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-369.59	\N	0.00	2304573	390.19	0.00	0.00	0.00
1533efef-1c48-4718-8d90-6210f4e5a761	b056757f-95bf-42ea-9c7e-3f75e459b726	1f72fdc5-fb49-4b52-a23f-c69554dc5b30	2026-04-06	2026-04-12	1476.68	-22.15	1311.37	130.03	0.00	0.00	0.00	1311.37	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-176.40	\N	0.00	4492804	1311.37	0.00	0.00	0.00
8b706f01-0edc-48f5-898b-8c2e5bea39ac	b056757f-95bf-42ea-9c7e-3f75e459b726	eb5d629c-bf85-494a-beaf-6e66885b6bad	2026-04-06	2026-04-12	941.53	-14.12	847.38	94.15	0.00	0.00	0.00	847.38	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	0.00	\N	0.00	2657194	847.38	0.00	0.00	0.00
402b71fc-44d7-4aa3-9768-d65b12c29a6b	b056757f-95bf-42ea-9c7e-3f75e459b726	8081d690-38de-4fb9-bd34-cdc176c35865	2026-04-06	2026-04-12	993.18	-14.90	889.20	94.66	0.00	0.00	0.00	889.20	paid	2026-04-19	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-46.62	\N	0.00	2835207	889.20	0.00	0.00	0.00
78111176-ce90-4bec-9236-afd25fc9946a	b056757f-95bf-42ea-9c7e-3f75e459b726	923fc82e-4730-47cb-ba9e-a8af9e9251cb	2026-04-06	2026-04-12	797.91	-11.97	699.65	61.32	0.00	0.00	0.00	699.65	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-184.74	\N	0.00	3871294	699.65	0.00	0.00	0.00
dfd17714-3219-4d03-8832-c2d797f618a9	b056757f-95bf-42ea-9c7e-3f75e459b726	8666eb6b-dc03-4c2a-a786-43d715b57f40	2026-04-06	2026-04-12	305.75	-4.59	263.76	19.17	0.00	0.00	0.00	263.76	paid	2026-04-18	\N	\N	\N	\N	\N	2026-04-18 12:30:44.683783	-114.12	\N	0.00	4150378	263.76	0.00	0.00	0.00
\.


--
-- TOC entry 3624 (class 0 OID 16632)
-- Dependencies: 212
-- Data for Name: drivers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.drivers (id, organization_id, user_id, first_name, last_name, email, phone, date_of_birth, address, license_number, license_expiry, license_class, hire_date, employment_status, commission_rate, base_commission_rate, commission_type, fixed_commission_amount, minimum_commission, uber_driver_id, bolt_driver_id, notes, created_at, updated_at, is_deleted, deleted_at, deleted_by, glovo_courier_id, bolt_courier_id, current_vehicle_id, profile_photo_url, profile_photo_updated_at, wolt_courier_id, wolt_courier_verified, wolt_courier_verified_at) FROM stdin;
9b926250-adf6-41f7-ae0a-1ccda760461f	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Umer	Hanan	Umerhanan537@gmail.com	0754637477	\N	\N	\N	\N	\N	\N	active	10.00	\N	percentage	0.00	0.00	\N	\N	This id have to Rehan friend Balaj kahan and its block	2026-04-15 12:03:54.733668	2026-04-24 20:03:59.896984	f	\N	\N	2490579	\N	\N	\N	\N	\N	f	\N
8081d690-38de-4fb9-bd34-cdc176c35865	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	MUHAMMAD	SAJJAD	Fnfriderglo04@gmail.com	0735337353	\N	\N	\N	\N	\N	\N	active	10.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:59:57.572675	2026-04-15 11:04:03.033124	f	\N	\N	2835207	\N	\N	\N	\N	\N	f	\N
3ab8471a-bafe-432e-acd3-76f09b88f3cf	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Arshad	Uzair	Rider.speed8@hotmail.com	07526226624	\N	\N	\N	\N	\N	\N	active	9.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:58:15.89786	2026-04-15 11:05:20.229597	f	\N	\N	3777223	\N	\N	\N	\N	\N	f	\N
11086bf8-3977-4f3d-8116-8c006cef839a	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	CHIMDESA	WAKTOLE	chimdochimdesa@gmail.com	072352752	\N	\N	\N	\N	\N	\N	active	8.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:57:12.95153	2026-04-15 11:06:18.408101	f	\N	\N	3820899	\N	\N	\N	\N	\N	f	\N
ae3fc6c2-5915-4f02-bd21-2c62c26d6092	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Ahmad	Danial	\N	07787463874	\N	\N	\N	\N	\N	\N	active	10.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:55:24.270247	2026-04-15 11:06:55.168858	f	\N	\N	4505090	\N	\N	\N	\N	\N	f	\N
3e99e189-5c59-4748-af33-132778fe46d9	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	UMAIR	AHMAD	ranaumair988@gmail.com	029437492	\N	\N	\N	\N	\N	\N	active	8.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:53:19.869508	2026-04-15 11:08:20.799441	f	\N	\N	4272617	\N	\N	\N	\N	\N	f	\N
4d7d391b-bf01-488f-b001-80cb7057b696	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	TAUQEER	ABBAS	Abbas213rider@outlook.com	079830329	\N	\N	\N	\N	\N	\N	active	10.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:52:32.356101	2026-04-15 11:09:31.540472	f	\N	\N	4422610	\N	\N	\N	\N	\N	f	\N
49cc11f3-1de9-4617-baa5-7b3cec38c3fe	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad Afzal	Arshad	Afzaalarshad05@gmail.com	073753738	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:10:59.088572	2026-04-15 11:10:59.088572	f	\N	\N	2592566	\N	\N	\N	\N	\N	f	\N
1f72fdc5-fb49-4b52-a23f-c69554dc5b30	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Irfan	Jhanzeb	emmaharry345@gmail.com	0753736737	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:12:51.539171	2026-04-15 11:12:51.539171	f	\N	\N	4492804	\N	\N	\N	\N	\N	f	\N
c2bdb349-2e52-4adb-9044-b6c683c2ab13	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Hussnain	Ali	eng.mikram786@gmail.com	07625638368	\N	\N	\N	\N	\N	\N	active	11.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:14:32.077003	2026-04-15 11:14:32.077003	f	\N	\N	4492805	\N	\N	\N	\N	\N	f	\N
6c4d01f6-5972-469a-83e5-36d9e49e91cf	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Jamil	Islam	pk.mikram777@gmail.com	075367388	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:15:54.21582	2026-04-15 11:15:54.21582	f	\N	\N	4492811	\N	\N	\N	\N	\N	f	\N
15cbbadf-c84d-435f-8393-30bdcca08c81	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad	Umair	muhammadumair89@gmail.com	074345785	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:17:29.225548	2026-04-15 11:17:29.225548	f	\N	\N	4150354	\N	\N	\N	\N	\N	f	\N
34ae1ec3-6f90-4898-9418-e9535c691ff2	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad	Najeeb Ullah	pk.mikram482@gmail.com	0756383637	\N	\N	\N	\N	\N	\N	active	10.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:20:24.228541	2026-04-15 11:20:24.228541	f	\N	\N	4494353	\N	\N	\N	\N	\N	f	\N
bdbdf261-cc6c-4ccc-8815-cb9787e437dc	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Raheel	Ahmad	Ahmadraheel0786@gmail.com	0745672383	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:22:03.744258	2026-04-15 11:22:03.744258	f	\N	\N	4501478	\N	\N	\N	\N	\N	f	\N
3f662a2e-3e89-49f8-beed-fe533d22b00e	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad Shahid	Ali	ladla1991@yahoo.com	0746483833	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:23:21.472615	2026-04-15 11:23:21.472615	f	\N	\N	2304573	\N	\N	\N	\N	\N	f	\N
5b18e6ec-238e-484b-808e-c3d5f1b74ac8	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Qamar	Ejaz	fnfriderglo08@gmail.com	07565757657	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:25:18.815846	2026-04-15 11:25:18.815846	f	\N	\N	2837774	\N	\N	\N	\N	\N	f	\N
23390533-03be-4c9e-a5e3-c84e1ecc268c	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Mohed	Ali	\N	07657686	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:31:10.033141	2026-04-15 11:31:10.033141	f	\N	\N	4505067	\N	\N	\N	\N	\N	f	\N
dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad	Afzal Khan	Mafazlkhan381@gmail.com	0756383897	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:32:37.583869	2026-04-15 11:32:37.583869	f	\N	\N	4505047	\N	\N	\N	\N	\N	f	\N
85e400cf-9b36-4ae3-ade6-13302a38d4ed	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Abhishek	Abhishek	Abhishek.abhishek23@gmail.com	0763537263	\N	\N	\N	\N	\N	\N	active	8.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:35:08.734202	2026-04-15 11:35:08.734202	f	\N	\N	4272517	\N	\N	\N	\N	\N	f	\N
40b8b06a-aeef-445d-8de5-549939e33f17	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Mujahid	Ali	mujahidsra11@gmail.com	0764354257	\N	\N	\N	\N	\N	\N	active	10.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:38:17.758213	2026-04-15 11:38:17.758213	f	\N	\N	4375550	\N	\N	\N	\N	\N	f	\N
5fee9303-c9e0-4c93-8d0b-e80daf790f69	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Ahsan	Ali	ahsanali1537@gmail.com	0764423546	\N	\N	\N	\N	\N	\N	active	8.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:48:49.361	2026-04-15 11:48:49.361	f	\N	\N	4375552	\N	\N	\N	\N	\N	f	\N
64d26978-b842-4b70-95b9-8cbdcc08e2f5	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Junaid	Ahmed	rider.speed11@hotmail.com	0735434524	\N	\N	\N	\N	\N	\N	active	11.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:51:48.362037	2026-04-15 11:51:48.362037	f	\N	\N	3776255	\N	\N	\N	\N	\N	f	\N
8666eb6b-dc03-4c2a-a786-43d715b57f40	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Hassan	Zohaib	Rider.glovo95@gmail.com	074354576	\N	\N	\N	\N	\N	\N	active	11.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:54:38.345245	2026-04-15 11:54:38.345245	f	\N	\N	4150378	\N	\N	\N	\N	\N	f	\N
277d19f6-4a38-4909-9ddb-d1e83de5e014	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Husain	Khan	musaaqif@gmail.com	0763522345	\N	\N	\N	\N	\N	\N	active	8.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:56:54.543112	2026-04-15 11:56:54.543112	f	\N	\N	4466674	\N	\N	\N	\N	\N	f	\N
fedc175f-938e-4022-a4d8-463633357218	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad	Umer Baig	\N	075466364	\N	\N	\N	\N	\N	\N	active	9.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 12:01:12.091268	2026-04-15 12:01:12.091268	f	\N	\N	4480947	\N	\N	\N	\N	\N	f	\N
0ca3b8ed-0d55-4bff-957e-b453a12105cc	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad	Bilal	Utt.rider75@gmail.com	0764535342	\N	\N	\N	\N	\N	\N	active	5.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-15 12:05:54.101585	2026-04-15 12:05:54.101585	f	\N	\N	2599609	\N	\N	\N	\N	\N	f	\N
9c237234-03d6-4923-8069-fab63f995c70	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Vikram	Singh	rider.speed5@hotmail.com	0753674736	\N	\N	\N	\N	\N	\N	active	12.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:59:30.942328	2026-04-15 12:37:42.292986	f	\N	\N	3663447	\N	\N	\N	\N	\N	f	\N
2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Ghalib	Mahmood	Uptowntrans09@gmail.com	07533763337	\N	\N	\N	\N	\N	\N	active	10.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:02:14.392256	2026-04-16 02:16:07.333223	f	\N	\N	2311096	\N	\N	\N	\N	\N	f	\N
eb5d629c-bf85-494a-beaf-6e66885b6bad	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Noman	Farooq	nomanfarooq93@gmail.com	076456535	\N	\N	\N	\N	\N	\N	active	10.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:52:59.434503	2026-04-18 13:36:58.607356	f	\N	\N	2657194	\N	\N	\N	\N	\N	f	\N
49004ab2-6583-4cad-8ba6-a74178f458db	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Rakesh	Kumar	eymanorrider05@gmail.com	0779375836	\N	\N	\N	\N	\N	\N	active	10.00	20.00	percentage	0.00	0.00	\N	\N	\N	2026-04-18 13:15:01.213201	2026-04-27 02:49:30.545285	f	\N	\N	4579029	\N	\N	\N	\N	\N	f	\N
124a7a0f-fb31-4a2a-a2d1-e7dbba840603	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Haile	Dejene Birhanu	Rider.glovo19@outlook.com	07353363783	\N	\N	\N	\N	\N	\N	active	8.00	\N	percentage	0.00	0.00	\N	\N	This id i give Sohaib but i need to increase Comission 9% after 13 to 19 week	2026-04-15 11:00:48.173393	2026-04-27 14:28:06.666581	f	\N	\N	3802716	\N	\N	\N	\N	\N	f	\N
89dd665f-5fac-40a3-8df6-667e78d80ac7	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	MUHAMMAD	ZEESHAN IQBAL	ff.muhammadzeeshan1@outlook.com	0923478273	\N	\N	\N	\N	\N	\N	active	8.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 10:54:46.912724	2026-04-27 14:02:42.291013	f	\N	\N	4340056	\N	\N	\N	\N	\N	f	\N
0b126711-4db1-4eba-9255-0ec8719d2acb	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Abdul	Ahad	fnfriderglo02@gmail.com	076474784	\N	\N	\N	\N	\N	\N	terminated	9.00	\N	percentage	0.00	0.00	\N	\N	\N	2026-04-15 11:27:17.011424	2026-04-21 19:49:15.078041	t	2026-04-21 19:49:15.078041	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2828721	\N	\N	\N	\N	\N	f	\N
eed86734-204b-41f1-9d0e-bdf82d71a7f0	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Muhammad	Sarfraz	\N	0773437851	2002-02-17	STR Tineretului 35BIS AP 36	\N	\N	\N	2026-04-18	active	8.00	\N	percentage	0.00	0.00	\N	\N	This ID i give to sarfaraz but after 13 to 19 week need to update comission upto 11%	2026-04-21 19:29:34.132195	2026-04-27 14:30:15.437777	f	\N	\N	2828721	\N	\N	\N	\N	\N	f	\N
923fc82e-4730-47cb-ba9e-a8af9e9251cb	b056757f-95bf-42ea-9c7e-3f75e459b726	\N	Birhane	Eyuael Melike	rider.glovo37@hotmail.com	0853567338	\N	\N	\N	\N	\N	\N	active	8.00	\N	percentage	0.00	0.00	\N	\N	Give to blaj and ad new comission next week after 21 to 26 April  and comission new is 10%.	2026-04-15 10:59:04.031314	2026-04-27 15:46:52.894489	f	\N	\N	3871294	\N	\N	\N	\N	\N	f	\N
\.


--
-- TOC entry 3635 (class 0 OID 24583)
-- Dependencies: 226
-- Data for Name: earnings_import_staging; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_import_staging (id, organization_id, import_id, row_index, payload, created_at) FROM stdin;
db3e16fd-ed83-44c7-8a9a-95a9d51a7622	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	0	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
1798286f-2f0f-43c2-aa95-d28b72b9fa0d	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	1	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
1307e908-d3b0-41e6-83b2-67b8dac31bf8	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	2	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
50c5b901-de7f-4722-b093-89331dabdf20	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	3	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
e1b22786-ef45-4a6c-adfe-5faf186efc83	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	4	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
7a472155-af19-476d-977f-2441aa16f2ef	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	5	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
b8327152-43c8-44cd-baf9-47ff9a1418c8	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	6	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
512004f3-716b-48bd-9dea-833388859868	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	7	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
27366d20-e427-40e8-bc43-a6ecaae4ed76	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	8	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
6ebf32b3-c6d1-4f59-b74c-39d7a6cd6c48	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	9	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
73d3bb67-76af-44bc-9d34-e2eb211929e2	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	10	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
6a01ed2b-3af3-47b8-a0b7-3d9795c65b62	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	11	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
5355eb66-96c5-4386-8a12-6c48254425c7	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	12	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
f17111a2-059f-4391-b5a8-c16b3964584f	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	13	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
176603ba-47a6-45c0-982c-92a19a2bbb27	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	14	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
d44cc000-121f-4e63-8663-e31367c34a74	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	15	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
fcc50b90-db3a-4f1a-ad82-c5dfbb010378	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	16	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
f75055e1-151f-4e65-bd6c-91280883a692	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	17	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
5c3b87b9-8c72-44d1-ad89-006034e91fe4	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	18	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
1bb711c5-7389-403c-b252-e31b43d6f054	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	19	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
274e33a1-ca7b-4d25-89c0-6c6baa7dfc5e	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	20	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
3542768e-5e17-404e-80a7-12ac0d1d1f36	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	21	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
4b7ca3b6-7019-4cda-89ee-24dcaae56344	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	22	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
88fe7c12-6061-4e6c-9d6c-548ca90074ea	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	23	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
52acf37a-77f7-459b-b38b-7b84872f963d	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	24	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
30dedbd7-372f-4cc5-9e24-f2ce11d8de5d	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	25	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
d726ccd7-34a0-4612-8805-55f24331c5d7	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	26	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
2171a62e-37e0-4311-8750-f9e0a88ce4cd	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	27	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
7c2a1272-97d8-4f59-886a-e31dce9610fd	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	28	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
c1556851-abb9-44b6-9a53-6f72b50c7082	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	29	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
04c05558-29b2-4035-9dce-8416bc2b3f24	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	30	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
b0139389-63b6-410e-9d6f-52c8926de3a2	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	31	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
d9c99b71-21ef-4d79-a11a-5d8f0e850a86	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	32	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
6f06752d-eaa7-435f-9123-a59401280182	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	33	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
7f9e50f4-0a4d-46cf-b956-5c758e33e832	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	34	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
8a0be985-7c5c-4f0a-bb13-9ecb5237be86	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	35	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
c6156fe8-eee9-45f7-874a-29261925101d	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	36	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
211e5758-04dc-4573-abc5-4a68de656d3b	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	37	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
1002434b-090d-4f94-8389-967aefdc7bed	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	38	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
d4ea61a3-076a-4659-8f18-cc08764c1cc1	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	39	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
3d25482d-3d2f-4178-8b68-6f05eec034b2	b056757f-95bf-42ea-9c7e-3f75e459b726	61ef4fe1-194e-4f26-8d49-e55b6380f74a	40	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:34:03.937039
97bacae9-ac73-440b-9cd9-2416555ecefb	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	0	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
88a137a1-2ab5-4389-a5cc-8dd66c06e03c	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	1	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
63c5b654-ca5e-4d68-8b02-87005e9bd4e3	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	2	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
62e12955-d033-4178-92e9-bf3a8fcabf27	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	3	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
b5ecfc9c-e87d-4689-a62c-3fb43eb0869c	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	4	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
3409204a-f832-4adc-8c0c-e4b21fbe7bcf	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	5	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
998d2a2e-0b0f-4473-8fb7-ffa1731758e6	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	6	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
85744228-0244-4efe-a1f8-5f88e4fce893	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	7	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
27122f85-9022-4434-87db-f9eddb044d37	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	8	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
f48ec6d8-ad92-46a8-8676-1f4a532d8ec9	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	9	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
26112c4b-1729-4782-a4d9-86d9db5765f3	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	10	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
1fff88b6-3a5e-495a-80ef-49f42446c1cb	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	11	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
d2379772-affe-4050-ade9-470dac184bf5	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	12	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
68a4958a-4467-4cfb-b353-fe63372e4057	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	13	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
efd579db-c3e9-4046-9b44-bad3f760a6d9	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	14	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
25164052-33b0-45fe-86ca-274aef8783c7	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	15	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
7c0ec554-88bb-41e9-9259-49787e66712a	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	16	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
3ac7d51d-9b96-41b9-98b9-07e0334f382c	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	17	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
fc0d40b9-07e6-413e-b248-f7fa6dd990b7	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	18	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
0919211e-326e-4240-8e4b-eb601b86a5d8	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	19	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
20cdce62-5e64-4b72-bd6e-8af1c5fdbca0	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	20	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
05faf157-903a-42b6-ac1a-e394722dca14	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	21	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
950db0fe-f119-4255-a246-d1128bec09bd	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	22	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
a86f34b6-f772-4e69-ac44-9b3dfaadfea9	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	23	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
462b8c2a-beec-498b-8dc6-d9d2d9fe885e	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	24	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
d85f7218-9fb5-43cf-90e2-f222cf1e330e	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	25	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
3cd662df-327e-4c49-b873-69618f9344f9	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	26	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
805639a2-5061-454f-ac85-ec7ae1ae2934	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	27	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
f2037622-90c8-4f95-a8be-6353e55994c1	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	28	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
f470cef0-e286-491f-be99-9c290231ff4c	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	29	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
06e8a734-a851-4010-afbb-2f103a18c468	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	30	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
f6a00514-c073-48ad-89c2-823d931fbeca	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	31	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
9f5f0b82-dd8c-4abb-8507-ab27375fa373	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	32	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
fa10ae87-bcf9-4ed8-9046-f4726473bb5b	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	33	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
3e7fad32-9d10-428b-ad0f-1873e2a50faa	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	34	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
2826aca3-b979-46a2-a4d7-da2ee20ffa90	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	35	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
7447c3d4-400c-4097-bbda-a7d824dbe826	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	36	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
ca08e8ee-39d7-48f6-ad3d-7840df27a342	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	37	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
8dbcaf7e-f893-4f60-af6b-0ed07726444d	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	38	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
4bc6b8ef-6e2e-4b2f-a9ad-efa24e8e1b42	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	39	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
fa362e08-1b42-4c2b-84b9-40d4a7c62517	b056757f-95bf-42ea-9c7e-3f75e459b726	22ddccc1-1c8e-4d96-9e33-5e8a40e58723	40	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:36:59.005595
921ff41d-60e4-4d9f-93a0-9cf516c78cc6	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	0	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
8f9c63d9-b5d4-43b5-bc64-1ec1e2b24824	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	1	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
aaa42f45-708b-413a-80f9-04c5aec77291	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	2	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
6caf388f-03c1-4b2a-b0c5-77772d93e4e2	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	3	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
543b0b56-0fd8-45d5-8500-3c8fcdc3f21e	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	4	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
7200e680-1b1d-4b4f-ac66-f68137f5b400	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	5	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
72ee57e0-83c1-4dbb-b653-b758754005ec	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	6	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
6abe800a-30a6-46d5-8802-2ff47931e253	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	7	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
d68b359f-81c7-4ad5-8051-4363d1dab6fb	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	8	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
ae1f9875-444d-469e-bca2-57f0feff33dc	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	9	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
f79371d6-009e-4cd8-886c-55a566f28eb0	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	10	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
be86e346-50a4-4474-945d-47207fe39f92	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	11	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
9d3e4dc4-2c2f-4be3-b62d-ad78eb7121e8	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	12	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
27d1ad43-2fa2-49ee-b6e2-63e8330f24b8	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	13	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
b1b0ce8c-b27f-474a-827a-2acff757ee97	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	14	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
2656f092-7dba-45fa-9bc2-db6fd55de5b6	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	15	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
89de118d-997b-4936-8054-43739ba90b17	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	16	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
3a8eb9a1-46de-43ef-9c5a-126276b1d329	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	17	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
92bb65e0-4be1-465e-bd85-1e14787ba864	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	18	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
1c3436a2-11bf-4954-a345-d4034af8b078	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	19	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
d3d6adfb-4e37-47f3-b64c-50148a5d3875	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	20	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
4b5fad14-92b3-418d-ac5a-c76738c17c63	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	21	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
be6cd5e1-ab6c-4968-9dc1-0a98850cfc01	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	22	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
eaae77cd-51e9-4f5a-862f-b2bf76127104	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	23	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
4525a954-8880-4c5b-9a46-3d780c8b5214	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	24	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
ef1b940d-41c6-40d3-b070-f37f847be7db	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	25	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
350a5006-5285-4086-a57c-196df2ca5956	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	26	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
6411ddff-33f6-43ea-b758-24f91f6cd5c6	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	27	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
75ae024d-ca84-49bf-aa15-19ff7ff0b140	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	28	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
576d64c3-4225-4012-88ed-ca5a1a4e1f6c	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	29	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
e99a4e29-b5c4-48f4-8409-4927a08a0917	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	30	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
be0db561-592c-4ac3-8c8b-b2a888d3cacd	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	31	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
064b4152-f753-4fcb-8a87-24a515c74b4c	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	32	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
7e57a598-deb5-403c-9b05-e8c0d6d32b2a	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	33	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
3c8736be-3452-4483-aff8-2613e87fabc0	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	34	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
80dd9601-76cf-4cb4-85fe-b07571bc49a5	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	35	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
74ceeaa7-cb5d-4dfe-810e-fda24bf689a7	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	36	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
c4a3d2b8-dc83-4c48-a524-5eea121154c7	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	37	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
7aa63ca4-9b1a-484f-8822-cae53485d854	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	38	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
df0d02ed-f760-4b38-aab3-b3d522f2ae18	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	39	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
a3f33f9b-68f1-4f8c-a251-064d3f0c9b88	b056757f-95bf-42ea-9c7e-3f75e459b726	9745cc2d-32af-44a5-bbf2-c5c39d989873	40	{"hints": {}, "amounts": {"net": null, "gross": null, "dailyCash": null, "tripCount": null, "platformFee": null, "transferTotal": null, "accountOpeningFee": null}, "rawSample": {}, "tripDateIso": null}	2026-05-01 20:38:59.223222
\.


--
-- TOC entry 3627 (class 0 OID 16721)
-- Dependencies: 215
-- Data for Name: earnings_imports; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_imports (id, organization_id, file_name, import_date, week_start, week_end, platform, total_gross, total_trips, record_count, imported_by, created_at, status, detection_meta) FROM stdin;
3826d410-0ea3-4b9e-8484-9c93c0f1b42a	b056757f-95bf-42ea-9c7e-3f75e459b726	6 to 12-April- Upload file.xlsx	2026-04-18	2026-04-06	2026-04-12	glovo	31012.05	2419	28	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-04-18 12:24:13.172564	completed	{"rowCount": 29, "headerCount": 11, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 1}
61ef4fe1-194e-4f26-8d49-e55b6380f74a	b056757f-95bf-42ea-9c7e-3f75e459b726	EYMANOR REPORTS 13-19-April.xlsx	2026-05-01	2026-05-01	2026-05-01	glovo	\N	\N	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-05-01 20:34:03.937039	preview	{"rowCount": 41, "headerCount": 28, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 0.6666666666666666}
22ddccc1-1c8e-4d96-9e33-5e8a40e58723	b056757f-95bf-42ea-9c7e-3f75e459b726	EYMANOR REPORTS 13-19-April.xlsx	2026-05-01	2026-05-01	2026-05-01	glovo	\N	\N	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-05-01 20:36:59.005595	preview	{"rowCount": 41, "headerCount": 28, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 0.6666666666666666}
9745cc2d-32af-44a5-bbf2-c5c39d989873	b056757f-95bf-42ea-9c7e-3f75e459b726	EYMANOR REPORTS 13-19-April.xlsx	2026-05-01	2026-05-01	2026-05-01	glovo	\N	\N	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-05-01 20:38:59.223222	preview	{"rowCount": 41, "headerCount": 28, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 0.6666666666666666}
\.


--
-- TOC entry 3628 (class 0 OID 16739)
-- Dependencies: 216
-- Data for Name: earnings_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_records (id, import_id, driver_id, platform, trip_date, trip_count, gross_earnings, platform_fee, net_earnings, company_commission, driver_payout, commission_type, created_at, total_transfer_earnings, daily_cash, transfer_commission, cash_commission, account_opening_fee, vehicle_rental_id, vehicle_rental_fee) FROM stdin;
ecabb229-7192-43f4-be58-13e6c15c2e32	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	923fc82e-4730-47cb-ba9e-a8af9e9251cb	glovo	2026-04-12	0	797.91	-11.97	699.65	61.32	699.65	percentage	2026-04-18 12:30:44.683783	797.91	-184.74	79.79	-18.47	\N	\N	\N
b8c592e1-c3e4-4b5f-9fbe-9749b01aa605	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	15cbbadf-c84d-435f-8393-30bdcca08c81	glovo	2026-04-12	97	1368.60	-20.53	1222.45	127.57	1222.45	percentage	2026-04-18 12:30:44.683783	1368.60	-92.86	136.86	-9.29	\N	\N	\N
f4b13f52-bff7-44fd-8f09-f3781325c52c	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	0ca3b8ed-0d55-4bff-957e-b453a12105cc	glovo	2026-04-12	0	13.29	-0.20	2.34	-8.29	2.34	percentage	2026-04-18 12:30:44.683783	13.29	-96.16	1.33	-9.62	\N	\N	\N
3c956508-fbc7-4a7d-8df2-29a5657c720f	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	4d7d391b-bf01-488f-b001-80cb7057b696	glovo	2026-04-12	0	206.08	-3.09	153.84	-11.02	153.84	percentage	2026-04-18 12:30:44.683783	206.08	-316.28	20.61	-31.63	\N	\N	\N
8fd052b3-6e83-468c-bda2-a4544fc6b346	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	5fee9303-c9e0-4c93-8d0b-e80daf790f69	glovo	2026-04-12	355	2430.96	-36.46	2129.23	184.47	2129.23	percentage	2026-04-18 12:30:44.683783	2430.96	-586.27	243.10	-58.63	\N	\N	\N
76312a47-af6d-42bb-96bb-3034f1a083ce	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	3ab8471a-bafe-432e-acd3-76f09b88f3cf	glovo	2026-04-12	0	599.43	-8.99	527.72	48.17	527.72	percentage	2026-04-18 12:30:44.683783	599.43	-117.67	59.94	-11.77	\N	\N	\N
615bee76-4166-4f1d-be49-f114e8f86869	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	glovo	2026-04-12	0	796.93	-11.95	717.01	79.46	717.01	percentage	2026-04-18 12:30:44.683783	796.93	-2.29	79.69	-0.23	\N	\N	\N
2dc9fb50-fbb7-4ec7-961b-1f844cb1c88c	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	glovo	2026-04-12	0	620.93	-9.31	525.62	28.87	525.62	percentage	2026-04-18 12:30:44.683783	620.93	-332.23	62.09	-33.22	\N	\N	\N
0ae4435c-5356-4a42-9f2d-55c8433bffed	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	89dd665f-5fac-40a3-8df6-667e78d80ac7	glovo	2026-04-12	0	772.63	-11.59	670.21	52.10	670.21	percentage	2026-04-18 12:30:44.683783	772.63	-251.62	77.26	-25.16	\N	\N	\N
633edb25-3cbe-41af-a7cb-6227ed933e97	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	40b8b06a-aeef-445d-8de5-549939e33f17	glovo	2026-04-12	0	867.80	-13.02	770.92	76.68	770.92	percentage	2026-04-18 12:30:44.683783	867.80	-101.02	86.78	-10.10	\N	\N	\N
42848cdd-ed54-4cd6-9cfe-11d4cba5d40c	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	277d19f6-4a38-4909-9ddb-d1e83de5e014	glovo	2026-04-12	97	1115.27	-16.73	997.79	105.58	997.79	percentage	2026-04-18 12:30:44.683783	1115.27	-59.53	111.53	-5.95	\N	\N	\N
7e234959-e77a-4b68-b798-ad3d16b7e448	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	11086bf8-3977-4f3d-8116-8c006cef839a	glovo	2026-04-12	179	1873.38	-28.10	1686.04	187.34	1686.04	percentage	2026-04-18 12:30:44.683783	1873.38	0.00	187.34	0.00	\N	\N	\N
66980c1d-3308-4098-9ebb-ce3db12375a2	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	0b126711-4db1-4eba-9255-0ec8719d2acb	glovo	2026-04-12	101	1453.10	-21.80	1295.41	132.93	1295.41	percentage	2026-04-18 12:30:44.683783	1453.10	-123.82	145.31	-12.38	\N	\N	\N
7d013076-b396-403d-bbad-20384da5bf8e	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	glovo	2026-04-12	0	566.32	-8.49	500.40	47.34	500.40	percentage	2026-04-18 12:30:44.683783	566.32	-92.87	56.63	-9.29	\N	\N	\N
28bebb6c-012f-478c-870d-519de2a79b78	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	glovo	2026-04-12	685	3388.47	-50.83	3049.62	338.85	3049.62	percentage	2026-04-18 12:30:44.683783	3388.47	0.00	338.85	0.00	\N	\N	\N
1cd61217-2bf1-451d-9268-05eff8597678	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	3e99e189-5c59-4748-af33-132778fe46d9	glovo	2026-04-12	0	543.32	-8.15	488.99	54.33	488.99	percentage	2026-04-18 12:30:44.683783	543.32	0.00	54.33	0.00	\N	\N	\N
e5ab4fc1-ad60-44f9-a8ae-e2efcf6a06fa	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	64d26978-b842-4b70-95b9-8cbdcc08e2f5	glovo	2026-04-12	101	1047.68	-15.72	942.91	104.77	942.91	percentage	2026-04-18 12:30:44.683783	1047.68	0.00	104.77	0.00	\N	\N	\N
a5ba6630-ea4d-4199-aad0-ca70a58ca2d2	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	bdbdf261-cc6c-4ccc-8815-cb9787e437dc	glovo	2026-04-12	138	1408.63	-21.13	1267.77	140.86	1267.77	percentage	2026-04-18 12:30:44.683783	1408.63	0.00	140.86	0.00	\N	\N	\N
dd217022-23e3-4748-9e11-7b251c2b01ba	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	23390533-03be-4c9e-a5e3-c84e1ecc268c	glovo	2026-04-12	349	2314.65	-34.72	2083.18	231.47	2083.18	percentage	2026-04-18 12:30:44.683783	2314.65	0.00	231.47	0.00	\N	\N	\N
f6b30cda-6ad2-4efa-a11e-6dab1038d6ca	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	85e400cf-9b36-4ae3-ade6-13302a38d4ed	glovo	2026-04-12	0	724.24	-10.86	617.86	38.46	617.86	percentage	2026-04-18 12:30:44.683783	724.24	-339.59	72.42	-33.96	\N	\N	\N
10d6702c-8d4c-4d4b-bf32-ae8aee3ce0a3	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	34ae1ec3-6f90-4898-9418-e9535c691ff2	glovo	2026-04-12	0	691.71	-10.38	622.54	69.17	622.54	percentage	2026-04-18 12:30:44.683783	691.71	0.00	69.17	0.00	\N	\N	\N
1d50d000-2d7c-4563-9348-dc2abb02a354	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	8666eb6b-dc03-4c2a-a786-43d715b57f40	glovo	2026-04-12	0	305.75	-4.59	263.76	19.17	263.76	percentage	2026-04-18 12:30:44.683783	305.75	-114.12	30.58	-11.41	\N	\N	\N
77600a6f-84ab-483d-8cef-f75007257177	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	3f662a2e-3e89-49f8-beed-fe533d22b00e	glovo	2026-04-12	0	474.61	-7.12	390.19	10.50	390.19	percentage	2026-04-18 12:30:44.683783	474.61	-369.59	47.46	-36.96	\N	\N	\N
b0b00159-706e-4e0e-bdb3-ca761b32e570	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	5b18e6ec-238e-484b-808e-c3d5f1b74ac8	glovo	2026-04-12	0	1378.64	-20.68	1235.93	133.01	1235.93	percentage	2026-04-18 12:30:44.683783	1378.64	-48.51	137.86	-4.85	\N	\N	\N
44031852-ebe0-4b56-ac31-cbe742b46bed	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	1f72fdc5-fb49-4b52-a23f-c69554dc5b30	glovo	2026-04-12	138	1476.68	-22.15	1311.37	130.03	1311.37	percentage	2026-04-18 12:30:44.683783	1476.68	-176.40	147.67	-17.64	\N	\N	\N
a018464d-430f-49df-a37e-270780fb7833	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	6c4d01f6-5972-469a-83e5-36d9e49e91cf	glovo	2026-04-12	179	1840.33	-27.60	1644.86	172.59	1644.86	percentage	2026-04-18 12:30:44.683783	1840.33	-114.43	184.03	-11.44	\N	\N	\N
4095e82f-26a3-4048-a939-556a4969f744	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	eb5d629c-bf85-494a-beaf-6e66885b6bad	glovo	2026-04-12	0	941.53	-14.12	847.38	94.15	847.38	percentage	2026-04-18 12:30:44.683783	941.53	0.00	94.15	0.00	\N	\N	\N
4595a099-2de4-4ee7-ba05-0004cacbc665	3826d410-0ea3-4b9e-8484-9c93c0f1b42a	8081d690-38de-4fb9-bd34-cdc176c35865	glovo	2026-04-12	0	993.18	-14.90	889.20	94.66	889.20	percentage	2026-04-18 12:30:44.683783	993.18	-46.62	99.32	-4.66	\N	\N	\N
\.


--
-- TOC entry 3622 (class 0 OID 16600)
-- Dependencies: 210
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organizations (id, name, email, phone, address, logo_url, settings, created_at, updated_at) FROM stdin;
b056757f-95bf-42ea-9c7e-3f75e459b726	Eyenamor	muhammadikramjnd@gmail.com	\N	\N	\N	{}	2026-03-06 16:55:23.612955	2026-03-06 16:55:23.612955
\.


--
-- TOC entry 3637 (class 0 OID 24795)
-- Dependencies: 229
-- Data for Name: payout_adjustments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payout_adjustments (id, organization_id, payout_id, amount, reason, adjustment_type, created_by, created_at) FROM stdin;
\.


--
-- TOC entry 3623 (class 0 OID 16613)
-- Dependencies: 211
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, organization_id, email, password_hash, first_name, last_name, phone, role, avatar_url, is_active, last_login, created_at, updated_at) FROM stdin;
7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	b056757f-95bf-42ea-9c7e-3f75e459b726	muhammadikramjnd@gmail.com	$2b$10$p1wgSuIxPYSa0uidfe/up..upJPfw/d6ECHTxy9MDlRJJpkvOV76O	Eyenamor	Admin	\N	admin	\N	t	\N	2026-03-06 16:55:23.612955	2026-03-06 16:55:23.612955
\.


--
-- TOC entry 3633 (class 0 OID 17018)
-- Dependencies: 224
-- Data for Name: vehicle_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_documents (id, vehicle_id, organization_id, document_type, document_number, file_name, file_path, file_size, expiry_date, issue_date, is_verified, verified_by, verified_at, notes, uploaded_by, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3632 (class 0 OID 16991)
-- Dependencies: 223
-- Data for Name: vehicle_maintenance; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_maintenance (id, vehicle_id, maintenance_type, description, cost, scheduled_date, completed_date, status, mechanic_name, notes, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3631 (class 0 OID 16950)
-- Dependencies: 222
-- Data for Name: vehicle_rentals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_rentals (id, vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date, rental_type, total_rent_amount, deposit_amount, payment_status, payment_date, payment_method, payment_reference, status, notes, created_by, created_at, updated_at, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason) FROM stdin;
2384544a-74ea-4fe7-beef-8e860b5c1868	815ae606-ec05-4e41-b49a-39db1a9400bb	eb5d629c-bf85-494a-beaf-6e66885b6bad	b056757f-95bf-42ea-9c7e-3f75e459b726	2026-04-14	2026-04-17	weekly	180.00	0.00	pending	\N	\N	\N	completed	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-04-18 13:36:37.730545	2026-04-18 13:36:58.592644	\N	\N	\N	0.00	\N
e3ac8ebb-0cb8-49b2-88ea-c2687f026e97	815ae606-ec05-4e41-b49a-39db1a9400bb	49004ab2-6583-4cad-8ba6-a74178f458db	b056757f-95bf-42ea-9c7e-3f75e459b726	2026-04-27	2026-05-10	weekly	630.00	200.00	pending	\N	cash	\N	completed	\N	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-04-27 02:45:21.175905	2026-04-27 02:49:30.529956	paid	2026-04-26 21:46:05.346	\N	0.00	\N
\.


--
-- TOC entry 3630 (class 0 OID 16919)
-- Dependencies: 221
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicles (id, organization_id, vehicle_type, make, model, year, color, license_plate, vin, fuel_type, transmission, seating_capacity, daily_rent, weekly_rent, monthly_rent, insurance_expiry, registration_expiry, status, current_driver_id, notes, created_at, updated_at) FROM stdin;
815ae606-ec05-4e41-b49a-39db1a9400bb	b056757f-95bf-42ea-9c7e-3f75e459b726	Scooter	Liberty	Piaggio	2020	White	B910FAF	\N	Petrol	Automatic	2	0.00	315.00	0.00	\N	\N	available	\N	\N	2026-04-15 12:11:45.421438	2026-04-27 02:49:30.538435
\.


--
-- TOC entry 3426 (class 2606 OID 17110)
-- Name: deposit_transactions deposit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 3381 (class 2606 OID 16708)
-- Name: driver_activities driver_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_pkey PRIMARY KEY (id);


--
-- TOC entry 3375 (class 2606 OID 16671)
-- Name: driver_documents driver_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);


--
-- TOC entry 3394 (class 2606 OID 16769)
-- Name: driver_payouts driver_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_pkey PRIMARY KEY (id);


--
-- TOC entry 3364 (class 2606 OID 16649)
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- TOC entry 3431 (class 2606 OID 24591)
-- Name: earnings_import_staging earnings_import_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_import_staging
    ADD CONSTRAINT earnings_import_staging_pkey PRIMARY KEY (id);


--
-- TOC entry 3385 (class 2606 OID 16728)
-- Name: earnings_imports earnings_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_pkey PRIMARY KEY (id);


--
-- TOC entry 3388 (class 2606 OID 16745)
-- Name: earnings_records earnings_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_pkey PRIMARY KEY (id);


--
-- TOC entry 3354 (class 2606 OID 16612)
-- Name: organizations organizations_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_email_key UNIQUE (email);


--
-- TOC entry 3356 (class 2606 OID 16610)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- TOC entry 3437 (class 2606 OID 24804)
-- Name: payout_adjustments payout_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_pkey PRIMARY KEY (id);


--
-- TOC entry 3360 (class 2606 OID 16626)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 3362 (class 2606 OID 16624)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3424 (class 2606 OID 17028)
-- Name: vehicle_documents vehicle_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_pkey PRIMARY KEY (id);


--
-- TOC entry 3417 (class 2606 OID 17002)
-- Name: vehicle_maintenance vehicle_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_maintenance
    ADD CONSTRAINT vehicle_maintenance_pkey PRIMARY KEY (id);


--
-- TOC entry 3413 (class 2606 OID 16966)
-- Name: vehicle_rentals vehicle_rentals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_pkey PRIMARY KEY (id);


--
-- TOC entry 3406 (class 2606 OID 16933)
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- TOC entry 3427 (class 1259 OID 17128)
-- Name: idx_deposit_transactions_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deposit_transactions_date ON public.deposit_transactions USING btree (transaction_date);


--
-- TOC entry 3428 (class 1259 OID 17126)
-- Name: idx_deposit_transactions_rental; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deposit_transactions_rental ON public.deposit_transactions USING btree (rental_id);


--
-- TOC entry 3429 (class 1259 OID 17127)
-- Name: idx_deposit_transactions_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deposit_transactions_status ON public.deposit_transactions USING btree (payment_status);


--
-- TOC entry 3382 (class 1259 OID 16720)
-- Name: idx_driver_activities_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_activities_created ON public.driver_activities USING btree (created_at DESC);


--
-- TOC entry 3383 (class 1259 OID 16719)
-- Name: idx_driver_activities_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_activities_driver ON public.driver_activities USING btree (driver_id);


--
-- TOC entry 3376 (class 1259 OID 16696)
-- Name: idx_driver_documents_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_driver ON public.driver_documents USING btree (driver_id);


--
-- TOC entry 3377 (class 1259 OID 16697)
-- Name: idx_driver_documents_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_organization ON public.driver_documents USING btree (organization_id);


--
-- TOC entry 3378 (class 1259 OID 16698)
-- Name: idx_driver_documents_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_type ON public.driver_documents USING btree (document_type);


--
-- TOC entry 3379 (class 1259 OID 16699)
-- Name: idx_driver_documents_verified; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_verified ON public.driver_documents USING btree (is_verified);


--
-- TOC entry 3395 (class 1259 OID 16789)
-- Name: idx_driver_payouts_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payouts_driver ON public.driver_payouts USING btree (driver_id);


--
-- TOC entry 3396 (class 1259 OID 24580)
-- Name: idx_driver_payouts_org_driver_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_driver_payouts_org_driver_period ON public.driver_payouts USING btree (organization_id, driver_id, payment_period_start, payment_period_end);


--
-- TOC entry 3397 (class 1259 OID 16791)
-- Name: idx_driver_payouts_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payouts_period ON public.driver_payouts USING btree (payment_period_start, payment_period_end);


--
-- TOC entry 3398 (class 1259 OID 24757)
-- Name: idx_driver_payouts_platform_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payouts_platform_id ON public.driver_payouts USING btree (platform_id);


--
-- TOC entry 3399 (class 1259 OID 16790)
-- Name: idx_driver_payouts_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payouts_status ON public.driver_payouts USING btree (payment_status);


--
-- TOC entry 3365 (class 1259 OID 16820)
-- Name: idx_drivers_bolt_courier_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_bolt_courier_id ON public.drivers USING btree (bolt_courier_id);


--
-- TOC entry 3366 (class 1259 OID 17015)
-- Name: idx_drivers_current_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_current_vehicle ON public.drivers USING btree (current_vehicle_id);


--
-- TOC entry 3367 (class 1259 OID 16819)
-- Name: idx_drivers_glovo_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_glovo_id ON public.drivers USING btree (glovo_courier_id);


--
-- TOC entry 3368 (class 1259 OID 16798)
-- Name: idx_drivers_is_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_is_deleted ON public.drivers USING btree (is_deleted);


--
-- TOC entry 3369 (class 1259 OID 16660)
-- Name: idx_drivers_org_license; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_drivers_org_license ON public.drivers USING btree (organization_id, license_number) WHERE (license_number IS NOT NULL);


--
-- TOC entry 3370 (class 1259 OID 16694)
-- Name: idx_drivers_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_organization ON public.drivers USING btree (organization_id);


--
-- TOC entry 3371 (class 1259 OID 17017)
-- Name: idx_drivers_profile_photo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_profile_photo ON public.drivers USING btree (profile_photo_url);


--
-- TOC entry 3372 (class 1259 OID 16695)
-- Name: idx_drivers_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_status ON public.drivers USING btree (employment_status);


--
-- TOC entry 3373 (class 1259 OID 17055)
-- Name: idx_drivers_wolt_courier_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_wolt_courier_id ON public.drivers USING btree (wolt_courier_id);


--
-- TOC entry 3386 (class 1259 OID 16785)
-- Name: idx_earnings_imports_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_imports_org ON public.earnings_imports USING btree (organization_id);


--
-- TOC entry 3389 (class 1259 OID 16787)
-- Name: idx_earnings_records_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_date ON public.earnings_records USING btree (trip_date);


--
-- TOC entry 3390 (class 1259 OID 16786)
-- Name: idx_earnings_records_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_driver ON public.earnings_records USING btree (driver_id);


--
-- TOC entry 3391 (class 1259 OID 16788)
-- Name: idx_earnings_records_import; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_import ON public.earnings_records USING btree (import_id);


--
-- TOC entry 3392 (class 1259 OID 24744)
-- Name: idx_earnings_records_vehicle_rental; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_vehicle_rental ON public.earnings_records USING btree (vehicle_rental_id) WHERE (vehicle_rental_id IS NOT NULL);


--
-- TOC entry 3432 (class 1259 OID 24602)
-- Name: idx_earnings_staging_import; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_staging_import ON public.earnings_import_staging USING btree (import_id);


--
-- TOC entry 3433 (class 1259 OID 24603)
-- Name: idx_earnings_staging_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_staging_org ON public.earnings_import_staging USING btree (organization_id);


--
-- TOC entry 3434 (class 1259 OID 24821)
-- Name: idx_payout_adjustments_org_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payout_adjustments_org_created ON public.payout_adjustments USING btree (organization_id, created_at DESC);


--
-- TOC entry 3435 (class 1259 OID 24820)
-- Name: idx_payout_adjustments_org_payout; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payout_adjustments_org_payout ON public.payout_adjustments USING btree (organization_id, payout_id);


--
-- TOC entry 3407 (class 1259 OID 17057)
-- Name: idx_rentals_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rentals_driver ON public.vehicle_rentals USING btree (driver_id);


--
-- TOC entry 3408 (class 1259 OID 17058)
-- Name: idx_rentals_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rentals_status ON public.vehicle_rentals USING btree (status);


--
-- TOC entry 3409 (class 1259 OID 17056)
-- Name: idx_rentals_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rentals_vehicle ON public.vehicle_rentals USING btree (vehicle_id);


--
-- TOC entry 3357 (class 1259 OID 16692)
-- Name: idx_users_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_organization ON public.users USING btree (organization_id);


--
-- TOC entry 3358 (class 1259 OID 16693)
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- TOC entry 3418 (class 1259 OID 17051)
-- Name: idx_vehicle_documents_expiry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_documents_expiry ON public.vehicle_documents USING btree (expiry_date);


--
-- TOC entry 3419 (class 1259 OID 17053)
-- Name: idx_vehicle_documents_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_documents_organization ON public.vehicle_documents USING btree (organization_id);


--
-- TOC entry 3420 (class 1259 OID 17050)
-- Name: idx_vehicle_documents_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_documents_type ON public.vehicle_documents USING btree (document_type);


--
-- TOC entry 3421 (class 1259 OID 17049)
-- Name: idx_vehicle_documents_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_documents_vehicle ON public.vehicle_documents USING btree (vehicle_id);


--
-- TOC entry 3422 (class 1259 OID 17052)
-- Name: idx_vehicle_documents_verified; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_documents_verified ON public.vehicle_documents USING btree (is_verified);


--
-- TOC entry 3414 (class 1259 OID 17009)
-- Name: idx_vehicle_maintenance_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_maintenance_status ON public.vehicle_maintenance USING btree (status);


--
-- TOC entry 3415 (class 1259 OID 17008)
-- Name: idx_vehicle_maintenance_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_maintenance_vehicle ON public.vehicle_maintenance USING btree (vehicle_id);


--
-- TOC entry 3410 (class 1259 OID 16989)
-- Name: idx_vehicle_rentals_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_organization ON public.vehicle_rentals USING btree (organization_id);


--
-- TOC entry 3411 (class 1259 OID 17016)
-- Name: idx_vehicle_rentals_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_period ON public.vehicle_rentals USING btree (rental_start_date, rental_end_date);


--
-- TOC entry 3400 (class 1259 OID 16948)
-- Name: idx_vehicles_current_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_current_driver ON public.vehicles USING btree (current_driver_id);


--
-- TOC entry 3401 (class 1259 OID 16947)
-- Name: idx_vehicles_license_plate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_license_plate ON public.vehicles USING btree (license_plate);


--
-- TOC entry 3402 (class 1259 OID 16944)
-- Name: idx_vehicles_org_license; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vehicles_org_license ON public.vehicles USING btree (organization_id, license_plate);


--
-- TOC entry 3403 (class 1259 OID 16945)
-- Name: idx_vehicles_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_organization ON public.vehicles USING btree (organization_id);


--
-- TOC entry 3404 (class 1259 OID 16946)
-- Name: idx_vehicles_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_status ON public.vehicles USING btree (status);


--
-- TOC entry 3477 (class 2620 OID 24747)
-- Name: earnings_records trg_earnings_records_match_vehicle_rental; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_earnings_records_match_vehicle_rental BEFORE INSERT OR UPDATE OF driver_id, trip_date ON public.earnings_records FOR EACH ROW EXECUTE FUNCTION public.earnings_records_match_vehicle_rental();


--
-- TOC entry 3478 (class 2620 OID 24794)
-- Name: earnings_records trg_earnings_records_payout_after_cash; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_earnings_records_payout_after_cash BEFORE INSERT OR UPDATE OF total_transfer_earnings, net_earnings, gross_earnings, platform_fee, transfer_commission, cash_commission, company_commission ON public.earnings_records FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_driver_payout_after_cash();


--
-- TOC entry 3469 (class 2606 OID 17121)
-- Name: deposit_transactions deposit_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 3470 (class 2606 OID 17116)
-- Name: deposit_transactions deposit_transactions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3471 (class 2606 OID 17111)
-- Name: deposit_transactions deposit_transactions_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE CASCADE;


--
-- TOC entry 3447 (class 2606 OID 16709)
-- Name: driver_activities driver_activities_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3448 (class 2606 OID 16714)
-- Name: driver_activities driver_activities_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- TOC entry 3443 (class 2606 OID 16672)
-- Name: driver_documents driver_documents_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3444 (class 2606 OID 16677)
-- Name: driver_documents driver_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3445 (class 2606 OID 16687)
-- Name: driver_documents driver_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 3446 (class 2606 OID 16682)
-- Name: driver_documents driver_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- TOC entry 3454 (class 2606 OID 16780)
-- Name: driver_payouts driver_payments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- TOC entry 3455 (class 2606 OID 16775)
-- Name: driver_payouts driver_payments_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3456 (class 2606 OID 16770)
-- Name: driver_payouts driver_payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3457 (class 2606 OID 24739)
-- Name: driver_payouts driver_payouts_vehicle_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payouts_vehicle_rental_id_fkey FOREIGN KEY (vehicle_rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE SET NULL;


--
-- TOC entry 3439 (class 2606 OID 17010)
-- Name: drivers drivers_current_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_current_vehicle_id_fkey FOREIGN KEY (current_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- TOC entry 3440 (class 2606 OID 16793)
-- Name: drivers drivers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- TOC entry 3441 (class 2606 OID 16655)
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 3472 (class 2606 OID 24597)
-- Name: earnings_import_staging earnings_import_staging_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_import_staging
    ADD CONSTRAINT earnings_import_staging_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.earnings_imports(id) ON DELETE CASCADE;


--
-- TOC entry 3473 (class 2606 OID 24592)
-- Name: earnings_import_staging earnings_import_staging_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_import_staging
    ADD CONSTRAINT earnings_import_staging_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3449 (class 2606 OID 16734)
-- Name: earnings_imports earnings_imports_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(id);


--
-- TOC entry 3450 (class 2606 OID 16729)
-- Name: earnings_imports earnings_imports_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3451 (class 2606 OID 16751)
-- Name: earnings_records earnings_records_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3452 (class 2606 OID 16746)
-- Name: earnings_records earnings_records_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.earnings_imports(id) ON DELETE CASCADE;


--
-- TOC entry 3453 (class 2606 OID 24672)
-- Name: earnings_records earnings_records_vehicle_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_vehicle_rental_id_fkey FOREIGN KEY (vehicle_rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE SET NULL;


--
-- TOC entry 3442 (class 2606 OID 16650)
-- Name: drivers fk_drivers_organization; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT fk_drivers_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3460 (class 2606 OID 16972)
-- Name: vehicle_rentals fk_rentals_driver; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT fk_rentals_driver FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3461 (class 2606 OID 16977)
-- Name: vehicle_rentals fk_rentals_organization; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT fk_rentals_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3462 (class 2606 OID 16967)
-- Name: vehicle_rentals fk_rentals_vehicle; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT fk_rentals_vehicle FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3458 (class 2606 OID 16939)
-- Name: vehicles fk_vehicles_current_driver; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT fk_vehicles_current_driver FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- TOC entry 3459 (class 2606 OID 16934)
-- Name: vehicles fk_vehicles_organization; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT fk_vehicles_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3474 (class 2606 OID 24815)
-- Name: payout_adjustments payout_adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 3475 (class 2606 OID 24805)
-- Name: payout_adjustments payout_adjustments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3476 (class 2606 OID 24810)
-- Name: payout_adjustments payout_adjustments_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.driver_payouts(id) ON DELETE CASCADE;


--
-- TOC entry 3438 (class 2606 OID 16627)
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- TOC entry 3465 (class 2606 OID 17034)
-- Name: vehicle_documents vehicle_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3466 (class 2606 OID 17044)
-- Name: vehicle_documents vehicle_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 3467 (class 2606 OID 17029)
-- Name: vehicle_documents vehicle_documents_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3468 (class 2606 OID 17039)
-- Name: vehicle_documents vehicle_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- TOC entry 3464 (class 2606 OID 17003)
-- Name: vehicle_maintenance vehicle_maintenance_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_maintenance
    ADD CONSTRAINT vehicle_maintenance_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3463 (class 2606 OID 16982)
-- Name: vehicle_rentals vehicle_rentals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 3644 (class 0 OID 0)
-- Dependencies: 3643
-- Name: DATABASE fleetmanager; Type: ACL; Schema: -; Owner: postgres
--

GRANT ALL ON DATABASE fleetmanager TO fleetadmin;


--
-- TOC entry 3645 (class 0 OID 0)
-- Dependencies: 5
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- TOC entry 3647 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE backup_017_driver_payments_cash_periods; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.backup_017_driver_payments_cash_periods TO fleetadmin;


--
-- TOC entry 3648 (class 0 OID 0)
-- Dependencies: 213
-- Name: TABLE driver_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.driver_documents TO fleetadmin;


--
-- TOC entry 3649 (class 0 OID 0)
-- Dependencies: 217
-- Name: TABLE driver_payouts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.driver_payouts TO fleetadmin;


--
-- TOC entry 3650 (class 0 OID 0)
-- Dependencies: 212
-- Name: TABLE drivers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.drivers TO fleetadmin;


--
-- TOC entry 3651 (class 0 OID 0)
-- Dependencies: 210
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.organizations TO fleetadmin;


--
-- TOC entry 3652 (class 0 OID 0)
-- Dependencies: 228
-- Name: TABLE dashboard_stats; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.dashboard_stats TO fleetadmin;


--
-- TOC entry 3653 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE deposit_transactions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.deposit_transactions TO fleetadmin;


--
-- TOC entry 3654 (class 0 OID 0)
-- Dependencies: 219
-- Name: TABLE document_verification_stats; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.document_verification_stats TO fleetadmin;


--
-- TOC entry 3655 (class 0 OID 0)
-- Dependencies: 214
-- Name: TABLE driver_activities; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.driver_activities TO fleetadmin;


--
-- TOC entry 3656 (class 0 OID 0)
-- Dependencies: 218
-- Name: TABLE driver_status_distribution; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.driver_status_distribution TO fleetadmin;


--
-- TOC entry 3657 (class 0 OID 0)
-- Dependencies: 226
-- Name: TABLE earnings_import_staging; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.earnings_import_staging TO fleetadmin;


--
-- TOC entry 3658 (class 0 OID 0)
-- Dependencies: 215
-- Name: TABLE earnings_imports; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.earnings_imports TO fleetadmin;


--
-- TOC entry 3659 (class 0 OID 0)
-- Dependencies: 216
-- Name: TABLE earnings_records; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.earnings_records TO fleetadmin;


--
-- TOC entry 3660 (class 0 OID 0)
-- Dependencies: 220
-- Name: TABLE monthly_earnings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.monthly_earnings TO fleetadmin;


--
-- TOC entry 3661 (class 0 OID 0)
-- Dependencies: 229
-- Name: TABLE payout_adjustments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.payout_adjustments TO fleetadmin;


--
-- TOC entry 3662 (class 0 OID 0)
-- Dependencies: 211
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO fleetadmin;


--
-- TOC entry 3663 (class 0 OID 0)
-- Dependencies: 224
-- Name: TABLE vehicle_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.vehicle_documents TO fleetadmin;


--
-- TOC entry 3664 (class 0 OID 0)
-- Dependencies: 223
-- Name: TABLE vehicle_maintenance; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.vehicle_maintenance TO fleetadmin;


--
-- TOC entry 3665 (class 0 OID 0)
-- Dependencies: 222
-- Name: TABLE vehicle_rentals; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.vehicle_rentals TO fleetadmin;


--
-- TOC entry 3666 (class 0 OID 0)
-- Dependencies: 221
-- Name: TABLE vehicles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.vehicles TO fleetadmin;


--
-- TOC entry 2114 (class 826 OID 16818)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES  TO fleetadmin;


-- Completed on 2026-05-01 20:40:59

--
-- PostgreSQL database dump complete
--

--
-- Database "postgres" dump
--

\connect postgres

--
-- PostgreSQL database dump
--

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 15.3

-- Started on 2026-05-01 20:40:59

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
-- TOC entry 5 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- TOC entry 2 (class 3079 OID 16386)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 3542 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 221 (class 1259 OID 17065)
-- Name: deposit_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deposit_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rental_id uuid,
    organization_id uuid,
    transaction_type character varying(50) NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    payment_status character varying(50) DEFAULT 'completed'::character varying,
    transaction_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT deposit_transactions_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT deposit_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['payment'::character varying, 'refund'::character varying, 'deduction'::character varying])::text[])))
);


ALTER TABLE public.deposit_transactions OWNER TO postgres;

--
-- TOC entry 214 (class 1259 OID 16497)
-- Name: driver_activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.driver_activities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    driver_id uuid,
    activity_type character varying(50) NOT NULL,
    activity_description text,
    performed_by uuid,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.driver_activities OWNER TO postgres;

--
-- TOC entry 213 (class 1259 OID 16458)
-- Name: driver_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.driver_documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    driver_id uuid,
    organization_id uuid,
    document_type character varying(50) NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_size integer,
    mime_type character varying(100),
    expiry_date date,
    is_verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp without time zone,
    uploaded_by uuid,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT driver_documents_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['id_card'::character varying, 'drivers_license'::character varying, 'contract'::character varying, 'insurance'::character varying, 'vehicle_permit'::character varying, 'other'::character varying])::text[])))
);


ALTER TABLE public.driver_documents OWNER TO postgres;

--
-- TOC entry 217 (class 1259 OID 16553)
-- Name: driver_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.driver_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    driver_id uuid,
    payment_period_start date NOT NULL,
    payment_period_end date NOT NULL,
    total_gross_earnings numeric(12,2),
    total_platform_fees numeric(10,2),
    total_net_earnings numeric(12,2),
    company_commission numeric(10,2),
    bonuses numeric(10,2) DEFAULT 0,
    penalties numeric(10,2) DEFAULT 0,
    adjustments numeric(10,2) DEFAULT 0,
    net_driver_payout numeric(10,2),
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    payment_date date,
    payment_method character varying(50),
    transaction_ref character varying(100),
    notes text,
    approved_by uuid,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT driver_payments_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'paid'::character varying, 'hold'::character varying])::text[])))
);


ALTER TABLE public.driver_payments OWNER TO postgres;

--
-- TOC entry 212 (class 1259 OID 16429)
-- Name: drivers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.drivers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    user_id uuid,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255),
    phone character varying(20) NOT NULL,
    date_of_birth date,
    address text,
    license_number character varying(50),
    license_expiry date,
    license_class character varying(20),
    hire_date date,
    employment_status character varying(50) DEFAULT 'active'::character varying,
    commission_rate numeric(5,2) DEFAULT 20.00,
    base_commission_rate numeric(5,2) DEFAULT 20.00,
    commission_type character varying(50) DEFAULT 'percentage'::character varying,
    fixed_commission_amount numeric(10,2) DEFAULT 0.00,
    minimum_commission numeric(10,2) DEFAULT 0.00,
    uber_driver_id character varying(100),
    bolt_driver_id character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    current_vehicle_id uuid,
    CONSTRAINT drivers_commission_type_check CHECK (((commission_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed_amount'::character varying, 'hybrid'::character varying])::text[]))),
    CONSTRAINT drivers_employment_status_check CHECK (((employment_status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'terminated'::character varying])::text[])))
);


ALTER TABLE public.drivers OWNER TO postgres;

--
-- TOC entry 215 (class 1259 OID 16518)
-- Name: earnings_imports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.earnings_imports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    file_name character varying(255),
    import_date date NOT NULL,
    week_start date NOT NULL,
    week_end date NOT NULL,
    platform character varying(50) NOT NULL,
    total_gross numeric(12,2),
    total_trips integer,
    record_count integer,
    imported_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT earnings_imports_platform_check CHECK (((platform)::text = ANY ((ARRAY['uber'::character varying, 'bolt'::character varying])::text[])))
);


ALTER TABLE public.earnings_imports OWNER TO postgres;

--
-- TOC entry 216 (class 1259 OID 16536)
-- Name: earnings_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.earnings_records (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    import_id uuid,
    driver_id uuid,
    platform character varying(50) NOT NULL,
    trip_date date NOT NULL,
    trip_count integer,
    gross_earnings numeric(10,2),
    platform_fee numeric(10,2),
    net_earnings numeric(10,2),
    company_commission numeric(10,2),
    driver_payout numeric(10,2),
    commission_type character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.earnings_records OWNER TO postgres;

--
-- TOC entry 210 (class 1259 OID 16397)
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organizations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(20),
    address text,
    logo_url character varying(500),
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.organizations OWNER TO postgres;

--
-- TOC entry 211 (class 1259 OID 16410)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone character varying(20),
    role character varying(50) NOT NULL,
    avatar_url character varying(500),
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'accountant'::character varying, 'driver'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16899)
-- Name: vehicle_maintenance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_maintenance (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vehicle_id uuid,
    maintenance_type character varying(50) NOT NULL,
    description text,
    cost numeric(10,2),
    scheduled_date date,
    completed_date date,
    status character varying(50) DEFAULT 'pending'::character varying,
    mechanic_name character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vehicle_maintenance_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.vehicle_maintenance OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16857)
-- Name: vehicle_rentals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_rentals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vehicle_id uuid,
    driver_id uuid,
    organization_id uuid,
    rental_start_date date NOT NULL,
    rental_end_date date NOT NULL,
    rental_type character varying(50) DEFAULT 'daily'::character varying,
    total_rent_amount numeric(10,2),
    deposit_amount numeric(10,2) DEFAULT 0.00,
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    payment_date date,
    payment_method character varying(50),
    payment_reference character varying(100),
    status character varying(50) DEFAULT 'active'::character varying,
    notes text,
    created_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deposit_status character varying(50) DEFAULT 'pending'::character varying,
    deposit_paid_at timestamp without time zone,
    deposit_refunded_at timestamp without time zone,
    deposit_deduction_amount numeric(10,2) DEFAULT 0.00,
    deposit_deduction_reason text,
    CONSTRAINT vehicle_rentals_deposit_status_check CHECK (((deposit_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'refunded'::character varying, 'partial'::character varying])::text[]))),
    CONSTRAINT vehicle_rentals_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'partial'::character varying, 'overdue'::character varying])::text[]))),
    CONSTRAINT vehicle_rentals_rental_type_check CHECK (((rental_type)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[]))),
    CONSTRAINT vehicle_rentals_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'overdue'::character varying])::text[])))
);


ALTER TABLE public.vehicle_rentals OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16821)
-- Name: vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    vehicle_type character varying(50) NOT NULL,
    make character varying(100) NOT NULL,
    model character varying(100) NOT NULL,
    year integer,
    color character varying(50),
    license_plate character varying(20) NOT NULL,
    vin character varying(100),
    fuel_type character varying(50),
    transmission character varying(50),
    seating_capacity integer,
    daily_rent numeric(10,2) DEFAULT 0.00,
    weekly_rent numeric(10,2) DEFAULT 0.00,
    monthly_rent numeric(10,2) DEFAULT 0.00,
    insurance_expiry date,
    registration_expiry date,
    status character varying(50) DEFAULT 'available'::character varying,
    current_driver_id uuid,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vehicles_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'rented'::character varying, 'maintenance'::character varying, 'sold'::character varying, 'scrapped'::character varying])::text[])))
);


ALTER TABLE public.vehicles OWNER TO postgres;

--
-- TOC entry 3535 (class 0 OID 17065)
-- Dependencies: 221
-- Data for Name: deposit_transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deposit_transactions (id, rental_id, organization_id, transaction_type, amount, payment_method, payment_status, transaction_date, notes, created_by, created_at) FROM stdin;
\.


--
-- TOC entry 3528 (class 0 OID 16497)
-- Dependencies: 214
-- Data for Name: driver_activities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.driver_activities (id, driver_id, activity_type, activity_description, performed_by, old_values, new_values, created_at) FROM stdin;
\.


--
-- TOC entry 3527 (class 0 OID 16458)
-- Dependencies: 213
-- Data for Name: driver_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.driver_documents (id, driver_id, organization_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, is_verified, verified_by, verified_at, uploaded_by, notes, created_at) FROM stdin;
\.


--
-- TOC entry 3531 (class 0 OID 16553)
-- Dependencies: 217
-- Data for Name: driver_payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.driver_payments (id, organization_id, driver_id, payment_period_start, payment_period_end, total_gross_earnings, total_platform_fees, total_net_earnings, company_commission, bonuses, penalties, adjustments, net_driver_payout, payment_status, payment_date, payment_method, transaction_ref, notes, approved_by, approved_at, created_at) FROM stdin;
\.


--
-- TOC entry 3526 (class 0 OID 16429)
-- Dependencies: 212
-- Data for Name: drivers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.drivers (id, organization_id, user_id, first_name, last_name, email, phone, date_of_birth, address, license_number, license_expiry, license_class, hire_date, employment_status, commission_rate, base_commission_rate, commission_type, fixed_commission_amount, minimum_commission, uber_driver_id, bolt_driver_id, notes, created_at, updated_at, current_vehicle_id) FROM stdin;
\.


--
-- TOC entry 3529 (class 0 OID 16518)
-- Dependencies: 215
-- Data for Name: earnings_imports; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_imports (id, organization_id, file_name, import_date, week_start, week_end, platform, total_gross, total_trips, record_count, imported_by, created_at) FROM stdin;
\.


--
-- TOC entry 3530 (class 0 OID 16536)
-- Dependencies: 216
-- Data for Name: earnings_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_records (id, import_id, driver_id, platform, trip_date, trip_count, gross_earnings, platform_fee, net_earnings, company_commission, driver_payout, commission_type, created_at) FROM stdin;
\.


--
-- TOC entry 3524 (class 0 OID 16397)
-- Dependencies: 210
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organizations (id, name, email, phone, address, logo_url, settings, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3525 (class 0 OID 16410)
-- Dependencies: 211
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, organization_id, email, password_hash, first_name, last_name, phone, role, avatar_url, is_active, last_login, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3534 (class 0 OID 16899)
-- Dependencies: 220
-- Data for Name: vehicle_maintenance; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_maintenance (id, vehicle_id, maintenance_type, description, cost, scheduled_date, completed_date, status, mechanic_name, notes, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3533 (class 0 OID 16857)
-- Dependencies: 219
-- Data for Name: vehicle_rentals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_rentals (id, vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date, rental_type, total_rent_amount, deposit_amount, payment_status, payment_date, payment_method, payment_reference, status, notes, created_by, created_at, updated_at, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason) FROM stdin;
\.


--
-- TOC entry 3532 (class 0 OID 16821)
-- Dependencies: 218
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicles (id, organization_id, vehicle_type, make, model, year, color, license_plate, vin, fuel_type, transmission, seating_capacity, daily_rent, weekly_rent, monthly_rent, insurance_expiry, registration_expiry, status, current_driver_id, notes, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3354 (class 2606 OID 17078)
-- Name: deposit_transactions deposit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 3319 (class 2606 OID 16505)
-- Name: driver_activities driver_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_pkey PRIMARY KEY (id);


--
-- TOC entry 3313 (class 2606 OID 16468)
-- Name: driver_documents driver_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);


--
-- TOC entry 3331 (class 2606 OID 16566)
-- Name: driver_payments driver_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_pkey PRIMARY KEY (id);


--
-- TOC entry 3307 (class 2606 OID 16446)
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- TOC entry 3323 (class 2606 OID 16525)
-- Name: earnings_imports earnings_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_pkey PRIMARY KEY (id);


--
-- TOC entry 3326 (class 2606 OID 16542)
-- Name: earnings_records earnings_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_pkey PRIMARY KEY (id);


--
-- TOC entry 3297 (class 2606 OID 16409)
-- Name: organizations organizations_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_email_key UNIQUE (email);


--
-- TOC entry 3299 (class 2606 OID 16407)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- TOC entry 3303 (class 2606 OID 16423)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 3305 (class 2606 OID 16421)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3352 (class 2606 OID 16910)
-- Name: vehicle_maintenance vehicle_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_maintenance
    ADD CONSTRAINT vehicle_maintenance_pkey PRIMARY KEY (id);


--
-- TOC entry 3348 (class 2606 OID 16873)
-- Name: vehicle_rentals vehicle_rentals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_pkey PRIMARY KEY (id);


--
-- TOC entry 3341 (class 2606 OID 16835)
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- TOC entry 3355 (class 1259 OID 17096)
-- Name: idx_deposit_transactions_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deposit_transactions_date ON public.deposit_transactions USING btree (transaction_date);


--
-- TOC entry 3356 (class 1259 OID 17094)
-- Name: idx_deposit_transactions_rental; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deposit_transactions_rental ON public.deposit_transactions USING btree (rental_id);


--
-- TOC entry 3357 (class 1259 OID 17095)
-- Name: idx_deposit_transactions_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deposit_transactions_status ON public.deposit_transactions USING btree (payment_status);


--
-- TOC entry 3320 (class 1259 OID 16517)
-- Name: idx_driver_activities_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_activities_created ON public.driver_activities USING btree (created_at DESC);


--
-- TOC entry 3321 (class 1259 OID 16516)
-- Name: idx_driver_activities_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_activities_driver ON public.driver_activities USING btree (driver_id);


--
-- TOC entry 3314 (class 1259 OID 16493)
-- Name: idx_driver_documents_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_driver ON public.driver_documents USING btree (driver_id);


--
-- TOC entry 3315 (class 1259 OID 16494)
-- Name: idx_driver_documents_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_organization ON public.driver_documents USING btree (organization_id);


--
-- TOC entry 3316 (class 1259 OID 16495)
-- Name: idx_driver_documents_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_type ON public.driver_documents USING btree (document_type);


--
-- TOC entry 3317 (class 1259 OID 16496)
-- Name: idx_driver_documents_verified; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_documents_verified ON public.driver_documents USING btree (is_verified);


--
-- TOC entry 3332 (class 1259 OID 16586)
-- Name: idx_driver_payments_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payments_driver ON public.driver_payments USING btree (driver_id);


--
-- TOC entry 3333 (class 1259 OID 16588)
-- Name: idx_driver_payments_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payments_period ON public.driver_payments USING btree (payment_period_start, payment_period_end);


--
-- TOC entry 3334 (class 1259 OID 16587)
-- Name: idx_driver_payments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_driver_payments_status ON public.driver_payments USING btree (payment_status);


--
-- TOC entry 3308 (class 1259 OID 16856)
-- Name: idx_drivers_current_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_current_vehicle ON public.drivers USING btree (current_vehicle_id);


--
-- TOC entry 3309 (class 1259 OID 16457)
-- Name: idx_drivers_org_license; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_drivers_org_license ON public.drivers USING btree (organization_id, license_number) WHERE (license_number IS NOT NULL);


--
-- TOC entry 3310 (class 1259 OID 16491)
-- Name: idx_drivers_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_organization ON public.drivers USING btree (organization_id);


--
-- TOC entry 3311 (class 1259 OID 16492)
-- Name: idx_drivers_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_drivers_status ON public.drivers USING btree (employment_status);


--
-- TOC entry 3324 (class 1259 OID 16582)
-- Name: idx_earnings_imports_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_imports_org ON public.earnings_imports USING btree (organization_id);


--
-- TOC entry 3327 (class 1259 OID 16584)
-- Name: idx_earnings_records_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_date ON public.earnings_records USING btree (trip_date);


--
-- TOC entry 3328 (class 1259 OID 16583)
-- Name: idx_earnings_records_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_driver ON public.earnings_records USING btree (driver_id);


--
-- TOC entry 3329 (class 1259 OID 16585)
-- Name: idx_earnings_records_import; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_earnings_records_import ON public.earnings_records USING btree (import_id);


--
-- TOC entry 3300 (class 1259 OID 16489)
-- Name: idx_users_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_organization ON public.users USING btree (organization_id);


--
-- TOC entry 3301 (class 1259 OID 16490)
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- TOC entry 3349 (class 1259 OID 16918)
-- Name: idx_vehicle_maintenance_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_maintenance_status ON public.vehicle_maintenance USING btree (status);


--
-- TOC entry 3350 (class 1259 OID 16917)
-- Name: idx_vehicle_maintenance_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_maintenance_vehicle ON public.vehicle_maintenance USING btree (vehicle_id);


--
-- TOC entry 3342 (class 1259 OID 16895)
-- Name: idx_vehicle_rentals_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_driver ON public.vehicle_rentals USING btree (driver_id);


--
-- TOC entry 3343 (class 1259 OID 16896)
-- Name: idx_vehicle_rentals_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_organization ON public.vehicle_rentals USING btree (organization_id);


--
-- TOC entry 3344 (class 1259 OID 16898)
-- Name: idx_vehicle_rentals_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_period ON public.vehicle_rentals USING btree (rental_start_date, rental_end_date);


--
-- TOC entry 3345 (class 1259 OID 16897)
-- Name: idx_vehicle_rentals_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_status ON public.vehicle_rentals USING btree (status);


--
-- TOC entry 3346 (class 1259 OID 16894)
-- Name: idx_vehicle_rentals_vehicle; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicle_rentals_vehicle ON public.vehicle_rentals USING btree (vehicle_id);


--
-- TOC entry 3335 (class 1259 OID 16850)
-- Name: idx_vehicles_current_driver; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_current_driver ON public.vehicles USING btree (current_driver_id);


--
-- TOC entry 3336 (class 1259 OID 16849)
-- Name: idx_vehicles_license_plate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_license_plate ON public.vehicles USING btree (license_plate);


--
-- TOC entry 3337 (class 1259 OID 16846)
-- Name: idx_vehicles_org_license; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vehicles_org_license ON public.vehicles USING btree (organization_id, license_plate);


--
-- TOC entry 3338 (class 1259 OID 16847)
-- Name: idx_vehicles_organization; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_organization ON public.vehicles USING btree (organization_id);


--
-- TOC entry 3339 (class 1259 OID 16848)
-- Name: idx_vehicles_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_status ON public.vehicles USING btree (status);


--
-- TOC entry 3382 (class 2606 OID 17089)
-- Name: deposit_transactions deposit_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 3383 (class 2606 OID 17084)
-- Name: deposit_transactions deposit_transactions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3384 (class 2606 OID 17079)
-- Name: deposit_transactions deposit_transactions_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE CASCADE;


--
-- TOC entry 3366 (class 2606 OID 16506)
-- Name: driver_activities driver_activities_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3367 (class 2606 OID 16511)
-- Name: driver_activities driver_activities_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- TOC entry 3362 (class 2606 OID 16469)
-- Name: driver_documents driver_documents_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3363 (class 2606 OID 16474)
-- Name: driver_documents driver_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3364 (class 2606 OID 16484)
-- Name: driver_documents driver_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 3365 (class 2606 OID 16479)
-- Name: driver_documents driver_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- TOC entry 3372 (class 2606 OID 16577)
-- Name: driver_payments driver_payments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- TOC entry 3373 (class 2606 OID 16572)
-- Name: driver_payments driver_payments_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3374 (class 2606 OID 16567)
-- Name: driver_payments driver_payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3359 (class 2606 OID 16851)
-- Name: drivers drivers_current_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_current_vehicle_id_fkey FOREIGN KEY (current_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- TOC entry 3360 (class 2606 OID 16447)
-- Name: drivers drivers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3361 (class 2606 OID 16452)
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 3368 (class 2606 OID 16531)
-- Name: earnings_imports earnings_imports_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(id);


--
-- TOC entry 3369 (class 2606 OID 16526)
-- Name: earnings_imports earnings_imports_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3370 (class 2606 OID 16548)
-- Name: earnings_records earnings_records_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3371 (class 2606 OID 16543)
-- Name: earnings_records earnings_records_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.earnings_imports(id) ON DELETE CASCADE;


--
-- TOC entry 3358 (class 2606 OID 16424)
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- TOC entry 3381 (class 2606 OID 16911)
-- Name: vehicle_maintenance vehicle_maintenance_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_maintenance
    ADD CONSTRAINT vehicle_maintenance_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3377 (class 2606 OID 16889)
-- Name: vehicle_rentals vehicle_rentals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 3378 (class 2606 OID 16879)
-- Name: vehicle_rentals vehicle_rentals_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3379 (class 2606 OID 16884)
-- Name: vehicle_rentals vehicle_rentals_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3380 (class 2606 OID 16874)
-- Name: vehicle_rentals vehicle_rentals_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3375 (class 2606 OID 16841)
-- Name: vehicles vehicles_current_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_current_driver_id_fkey FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- TOC entry 3376 (class 2606 OID 16836)
-- Name: vehicles vehicles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3541 (class 0 OID 0)
-- Dependencies: 5
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


-- Completed on 2026-05-01 20:41:03

--
-- PostgreSQL database dump complete
--

-- Completed on 2026-05-01 20:41:03

--
-- PostgreSQL database cluster dump complete
--

