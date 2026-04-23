--
-- PostgreSQL database cluster dump
--

-- Started on 2026-04-24 03:15:18

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE fleetadmin;
ALTER ROLE fleetadmin WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;

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

-- Dumped from database version 15.17 (Debian 15.17-1.pgdg13+1)
-- Dumped by pg_dump version 15.3

-- Started on 2026-04-24 03:15:18

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

-- Completed on 2026-04-24 03:15:18

--
-- PostgreSQL database dump complete
--

--
-- Database "fleetmanager" dump
--

--
-- PostgreSQL database dump
--

-- Dumped from database version 15.17 (Debian 15.17-1.pgdg13+1)
-- Dumped by pg_dump version 15.3

-- Started on 2026-04-24 03:15:18

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
-- TOC entry 3738 (class 1262 OID 16384)
-- Name: fleetmanager; Type: DATABASE; Schema: -; Owner: fleetadmin
--

CREATE DATABASE fleetmanager WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'en_US.utf8';


ALTER DATABASE fleetmanager OWNER TO fleetadmin;

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
-- TOC entry 2 (class 3079 OID 16389)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 3739 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- TOC entry 258 (class 1255 OID 49580)
-- Name: earnings_records_match_vehicle_rental(); Type: FUNCTION; Schema: public; Owner: fleetadmin
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


ALTER FUNCTION public.earnings_records_match_vehicle_rental() OWNER TO fleetadmin;

--
-- TOC entry 259 (class 1255 OID 49582)
-- Name: refresh_driver_payout_vehicle_fees(uuid); Type: FUNCTION; Schema: public; Owner: fleetadmin
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


ALTER FUNCTION public.refresh_driver_payout_vehicle_fees(p_org_id uuid) OWNER TO fleetadmin;

--
-- TOC entry 246 (class 1255 OID 49555)
-- Name: trg_enforce_driver_payout_after_cash(); Type: FUNCTION; Schema: public; Owner: fleetadmin
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


ALTER FUNCTION public.trg_enforce_driver_payout_after_cash() OWNER TO fleetadmin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 233 (class 1259 OID 49535)
-- Name: backup_017_driver_payments_cash_periods; Type: TABLE; Schema: public; Owner: fleetadmin
--

CREATE TABLE public.backup_017_driver_payments_cash_periods (
    id uuid,
    organization_id uuid,
    driver_id uuid,
    payment_period_start date,
    payment_period_end date,
    total_gross_earnings numeric(12,2),
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
    total_platform_fees numeric(10,2),
    total_net_earnings numeric(12,2),
    total_daily_cash numeric(12,2)
);


ALTER TABLE public.backup_017_driver_payments_cash_periods OWNER TO fleetadmin;

--
-- TOC entry 232 (class 1259 OID 49532)
-- Name: backup_017_earnings_records_cash_rows; Type: TABLE; Schema: public; Owner: fleetadmin
--

CREATE TABLE public.backup_017_earnings_records_cash_rows (
    id uuid,
    import_id uuid,
    driver_id uuid,
    platform character varying(50),
    trip_date date,
    trip_count integer,
    gross_earnings numeric(10,2),
    platform_fee numeric(10,2),
    net_earnings numeric(10,2),
    company_commission numeric(10,2),
    driver_payout numeric(10,2),
    commission_type character varying(50),
    created_at timestamp without time zone,
    total_transfer_earnings numeric(10,2),
    daily_cash numeric(10,2),
    transfer_commission numeric(10,2),
    cash_commission numeric(10,2),
    has_cash_commission boolean,
    driver_payout_after_cash numeric(10,2)
);


ALTER TABLE public.backup_017_earnings_records_cash_rows OWNER TO fleetadmin;

--
-- TOC entry 218 (class 1259 OID 16457)
-- Name: driver_documents; Type: TABLE; Schema: public; Owner: fleetadmin
--

CREATE TABLE public.driver_documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    driver_id uuid,
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
    organization_id uuid,
    CONSTRAINT driver_documents_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['trc_card'::character varying, 'drivers_license'::character varying, 'contract'::character varying, 'insurance'::character varying, 'vehicle_permit'::character varying, 'passport'::character varying, 'other'::character varying])::text[])))
);


ALTER TABLE public.driver_documents OWNER TO fleetadmin;

--
-- TOC entry 221 (class 1259 OID 16535)
-- Name: driver_payouts; Type: TABLE; Schema: public; Owner: fleetadmin
--

CREATE TABLE public.driver_payouts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    driver_id uuid,
    payment_period_start date NOT NULL,
    payment_period_end date NOT NULL,
    total_gross_earnings numeric(12,2),
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
    total_platform_fees numeric(10,2),
    total_net_earnings numeric(12,2),
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


ALTER TABLE public.driver_payouts OWNER TO fleetadmin;

--
-- TOC entry 217 (class 1259 OID 16432)
-- Name: drivers; Type: TABLE; Schema: public; Owner: fleetadmin
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
    uber_driver_id character varying(100),
    bolt_driver_id character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_deleted boolean DEFAULT false,
    deleted_at timestamp without time zone,
    deleted_by uuid,
    commission_type character varying(50) DEFAULT 'percentage'::character varying,
    fixed_commission_amount numeric(10,2) DEFAULT 0.00,
    minimum_commission numeric(10,2) DEFAULT 0.00,
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


ALTER TABLE public.drivers OWNER TO fleetadmin;

--
-- TOC entry 215 (class 1259 OID 16400)
-- Name: organizations; Type: TABLE; Schema: public; Owner: fleetadmin
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
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    commission_rate numeric(5,4) DEFAULT 0.10
);


ALTER TABLE public.organizations OWNER TO fleetadmin;

--
-- TOC entry 234 (class 1259 OID 49563)
-- Name: dashboard_stats; Type: VIEW; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.dashboard_stats OWNER TO fleetadmin;

--
-- TOC entry 230 (class 1259 OID 24984)
-- Name: deposit_transactions; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.deposit_transactions OWNER TO fleetadmin;

--
-- TOC entry 220 (class 1259 OID 16516)
-- Name: document_verification_stats; Type: VIEW; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.document_verification_stats OWNER TO fleetadmin;

--
-- TOC entry 219 (class 1259 OID 16489)
-- Name: driver_activities; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.driver_activities OWNER TO fleetadmin;

--
-- TOC entry 224 (class 1259 OID 16630)
-- Name: driver_status_distribution; Type: VIEW; Schema: public; Owner: fleetadmin
--

CREATE VIEW public.driver_status_distribution AS
 SELECT drivers.employment_status,
    count(*) AS count
   FROM public.drivers
  WHERE (drivers.organization_id = ( SELECT organizations.id
           FROM public.organizations
         LIMIT 1))
  GROUP BY drivers.employment_status;


ALTER TABLE public.driver_status_distribution OWNER TO fleetadmin;

--
-- TOC entry 231 (class 1259 OID 33140)
-- Name: earnings_import_staging; Type: TABLE; Schema: public; Owner: fleetadmin
--

CREATE TABLE public.earnings_import_staging (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    import_id uuid NOT NULL,
    row_index integer NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.earnings_import_staging OWNER TO fleetadmin;

--
-- TOC entry 222 (class 1259 OID 16589)
-- Name: earnings_imports; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.earnings_imports OWNER TO fleetadmin;

--
-- TOC entry 223 (class 1259 OID 16607)
-- Name: earnings_records; Type: TABLE; Schema: public; Owner: fleetadmin
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
    has_cash_commission boolean GENERATED ALWAYS AS ((COALESCE(cash_commission, (0)::numeric) < (0)::numeric)) STORED,
    account_opening_fee numeric(10,2),
    vehicle_rental_id uuid,
    vehicle_rental_fee numeric(10,2),
    driver_payout_after_cash numeric(10,2) GENERATED ALWAYS AS (round(((COALESCE(total_transfer_earnings, net_earnings, (COALESCE(gross_earnings, (0)::numeric) - COALESCE(platform_fee, (0)::numeric)), gross_earnings, (0)::numeric) - COALESCE(transfer_commission, (0)::numeric)) - abs(COALESCE(cash_commission, (0)::numeric))), 2)) STORED
);


ALTER TABLE public.earnings_records OWNER TO fleetadmin;

--
-- TOC entry 225 (class 1259 OID 16634)
-- Name: monthly_earnings; Type: VIEW; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.monthly_earnings OWNER TO fleetadmin;

--
-- TOC entry 235 (class 1259 OID 57751)
-- Name: payout_adjustments; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.payout_adjustments OWNER TO fleetadmin;

--
-- TOC entry 216 (class 1259 OID 16413)
-- Name: users; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.users OWNER TO fleetadmin;

--
-- TOC entry 229 (class 1259 OID 16751)
-- Name: vehicle_documents; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.vehicle_documents OWNER TO fleetadmin;

--
-- TOC entry 228 (class 1259 OID 16723)
-- Name: vehicle_maintenance; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.vehicle_maintenance OWNER TO fleetadmin;

--
-- TOC entry 227 (class 1259 OID 16686)
-- Name: vehicle_rentals; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.vehicle_rentals OWNER TO fleetadmin;

--
-- TOC entry 226 (class 1259 OID 16659)
-- Name: vehicles; Type: TABLE; Schema: public; Owner: fleetadmin
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


ALTER TABLE public.vehicles OWNER TO fleetadmin;

--
-- TOC entry 3731 (class 0 OID 49535)
-- Dependencies: 233
-- Data for Name: backup_017_driver_payments_cash_periods; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.backup_017_driver_payments_cash_periods (id, organization_id, driver_id, payment_period_start, payment_period_end, total_gross_earnings, company_commission, bonuses, penalties, adjustments, net_driver_payout, payment_status, payment_date, payment_method, transaction_ref, notes, approved_by, approved_at, created_at, total_platform_fees, total_net_earnings, total_daily_cash) FROM stdin;
88964ec0-8d4a-446f-add1-73ce789d575d	322e3576-685b-4a3b-9975-152c39ee7c03	46bcf8c1-2326-49a1-a4bc-388eff6d775e	2026-03-31	2026-04-07	4762.53	975.24	0.00	0.00	0.00	4026.44	pending	\N	\N	\N	\N	\N	\N	2026-04-08 14:58:06.194028	71.44	4026.44	-125.50
\.


--
-- TOC entry 3730 (class 0 OID 49532)
-- Dependencies: 232
-- Data for Name: backup_017_earnings_records_cash_rows; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.backup_017_earnings_records_cash_rows (id, import_id, driver_id, platform, trip_date, trip_count, gross_earnings, platform_fee, net_earnings, company_commission, driver_payout, commission_type, created_at, total_transfer_earnings, daily_cash, transfer_commission, cash_commission, has_cash_commission, driver_payout_after_cash) FROM stdin;
244e8273-c8ed-4a15-a54a-c76931e38e8d	cb8c9804-2589-49a1-be5c-39656b8e0ed3	46bcf8c1-2326-49a1-a4bc-388eff6d775e	glovo	2026-04-07	1505	4762.53	71.44	4026.44	975.24	4026.44	percentage	2026-04-08 14:58:06.194028	5001.68	-125.50	1000.34	-25.10	t	4026.44
\.


--
-- TOC entry 3728 (class 0 OID 24984)
-- Dependencies: 230
-- Data for Name: deposit_transactions; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.deposit_transactions (id, rental_id, organization_id, transaction_type, amount, payment_method, payment_status, transaction_date, notes, created_by, created_at) FROM stdin;
\.


--
-- TOC entry 3720 (class 0 OID 16489)
-- Dependencies: 219
-- Data for Name: driver_activities; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.driver_activities (id, driver_id, activity_type, activity_description, performed_by, old_values, new_values, created_at) FROM stdin;
7c2d9cf2-03a9-4f98-b0b9-5a678c45c853	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_due	Deposit of RON 200.00 due for vehicle rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "4c36caf4-ee7e-47bb-960e-1135489c2315", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 200}	2026-03-27 16:20:33.07384
a82c15f7-4749-4a80-8e52-38dfb6c1193c	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "7ee860af-6d8d-470b-aaf6-5b3ae7b68c3a", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-03-27 16:23:25.871151
4941e2d7-4699-4c31-9e8e-6f17114c4bbd	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_paid	Deposit of RON 200.00 marked as paid	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "4c36caf4-ee7e-47bb-960e-1135489c2315", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 200}	2026-03-27 16:28:11.72114
15680e78-568a-44e7-bc36-a2cea56cfce1	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "bf53ca5f-2dc0-4038-8eb0-5a9677714610", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-03-28 18:55:13.8557
223483a3-c76d-4556-8bda-822d8141b196	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "52d895da-4e61-466f-9821-6dfbacee7c7d", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-03-28 18:56:12.069005
44cb500e-c775-4cef-bc18-02efcbd7757c	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "6ef97d98-1783-4279-a3b9-881b541742c7", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-03-28 19:17:13.872825
d4bd9b53-2add-4154-9685-44329ad6f62d	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-05 14:46:56.732433
b0739245-525e-493b-aa77-1c89215c52f9	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-06 08:12:13.443615
9f516f19-46a7-4f9b-a88b-7b1fea818daa	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-06 08:12:28.648455
71fdfd5f-12bb-42a2-a606-fc0582411e28	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-06 08:14:33.592887
a259dd97-15b4-4998-9886-812d71bccd34	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-07 11:09:52.125884
408fdb95-1595-4594-983a-7e85463a21f4	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-07 20:47:54.518355
e1ccbf3c-ef03-4ce5-818b-0f01b8af6f1c	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-07 20:51:56.108338
2ff676df-5e01-45f1-8d0e-e52b28fbd5c1	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-08 16:43:50.450541
bee12271-f566-497a-9fce-c6e742a9015c	46bcf8c1-2326-49a1-a4bc-388eff6d775e	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-08 18:31:49.943567
a85bdf30-f864-44dd-8deb-c7c07459dcc6	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-08 19:48:42.320282
8aa732b0-39d1-40e4-ba84-d3476bea84b9	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_due	Deposit of RON 100.00 due for vehicle rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "1acfa1af-1676-4d63-88d1-463e6f23e836", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 06:02:05.974336
0149143c-3e86-480b-b040-07c99f7dca75	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_paid	Deposit of RON 100.00 marked as paid	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "1acfa1af-1676-4d63-88d1-463e6f23e836", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 06:02:15.776641
cc8e77e5-7488-43b3-9270-37e0d61d2d23	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "402157e0-3728-4c3a-8c93-d29b5d514cd0", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-09 11:47:46.67122
6b2944e0-7fa7-46ca-8b5a-1912f70163ba	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "3c6f6915-bf9b-4c57-b876-a0079aad9e5d", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-09 11:48:52.863051
76aff07b-c2b4-4a3e-838f-7d26a75cf53d	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_due	Deposit of RON 100.00 due for vehicle rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "99da511d-a4a1-4f74-a0d2-cde693297603", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 11:55:09.567518
9620a3fa-3423-4aa6-93e7-d3faaac7288d	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_paid	Deposit of RON 100.00 marked as paid	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "99da511d-a4a1-4f74-a0d2-cde693297603", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 11:55:15.784717
22132a5f-dc60-497d-99fa-2e601a9c12a0	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "40afdd4e-3acd-42c3-98d9-4d091feffeba", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-09 12:20:59.146909
10c4c6ea-004b-4c9f-8049-0cde46fae209	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "7d5aa2a3-f8de-49e6-936c-d03029d7b791", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-09 13:00:25.036968
9273758f-61de-4b6c-ae67-8294d781dec1	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "38dfdcd3-3b63-4a6d-b026-56195bcf2800", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-09 13:04:54.07493
8c157197-0c69-467a-8fa7-3fa85c927fb7	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_due	Deposit of RON 100.00 due for vehicle rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "ade27e12-2bd6-440a-8360-aa2de937d105", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 18:57:39.946589
7eff42c0-54bb-4cb6-ba9b-609a79a98415	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "a4b9a03c-b614-4109-b4de-3b784d95da33", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-09 19:19:44.560061
71f957a2-915d-4769-afb4-300ab1fe38bd	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_due	Deposit of RON 100.00 due for vehicle rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "37740ca5-46a0-42f2-8469-78454588b33a", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 19:21:17.032791
895c341b-e62d-487b-a6fb-4a1569d62e5e	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_due	Deposit of RON 100.00 due for vehicle rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "792fe9da-27e4-478f-a8dc-7058cd73ae8b", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 100}	2026-04-09 19:22:26.512143
27efbd76-38f6-40c4-8b17-a5e3410c38c0	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-15 20:49:02.67082
f73eb671-878f-400a-a024-03432db82173	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-15 21:01:30.989043
cab5b926-c1cf-40e8-aadb-2cc07a74be4b	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	deposit_not_required	No deposit requested for this rental	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	{"rental_id": "aff425ab-0aaa-4d74-a750-8c1f79ef0384", "vehicle_id": "8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51", "deposit_amount": 0, "fallback_rate_amount": 600}	2026-04-15 23:34:33.791691
2833ebe0-4ef9-4d25-9e0d-bf8ca5952fa4	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-16 15:18:41.92842
ac5ad5bb-f9e2-45a7-bbfc-3600f5575191	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-16 15:18:57.283796
15dfacc3-28d0-4441-9094-ba92eef782e2	46bcf8c1-2326-49a1-a4bc-388eff6d775e	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-16 15:19:40.394197
2a8bd0d9-0a2d-4349-af00-170f2843cc29	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-16 15:19:53.915663
1336ff77-79eb-4859-9689-202c33e7e654	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-16 15:20:41.895135
aa132417-6e8f-4ae3-970a-dc2b70fc31d8	46bcf8c1-2326-49a1-a4bc-388eff6d775e	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-16 15:20:57.867441
4adb2031-e945-4864-918a-bfd29b8798fe	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	profile_update	Driver profile updated	0b070cf9-3d06-4bff-af41-b0ae7591e027	\N	\N	2026-04-17 13:08:38.202807
\.


--
-- TOC entry 3719 (class 0 OID 16457)
-- Dependencies: 218
-- Data for Name: driver_documents; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.driver_documents (id, driver_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, is_verified, verified_by, verified_at, uploaded_by, notes, created_at, organization_id) FROM stdin;
\.


--
-- TOC entry 3721 (class 0 OID 16535)
-- Dependencies: 221
-- Data for Name: driver_payouts; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.driver_payouts (id, organization_id, driver_id, payment_period_start, payment_period_end, total_gross_earnings, company_commission, bonuses, penalties, adjustments, net_driver_payout, payment_status, payment_date, payment_method, transaction_ref, notes, approved_by, approved_at, created_at, total_platform_fees, total_net_earnings, total_daily_cash, vehicle_rental_id, vehicle_rental_fee, platform_id, raw_net_amount, debt_amount, debt_applied_amount, remaining_debt_amount) FROM stdin;
9353d84f-f968-4b11-8fca-ec42bad9fb68	322e3576-685b-4a3b-9975-152c39ee7c03	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	2026-04-10	2026-04-17	599.43	65.24	0.00	0.00	0.00	452.07	paid	2026-04-17	\N	\N	\N	\N	\N	2026-04-17 21:49:19.015363	-8.99	452.07	-117.67	\N	0.00	3777223	452.07	0.00	0.00	0.00
793e807d-0fa6-49b5-a0fd-004183d48632	322e3576-685b-4a3b-9975-152c39ee7c03	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	2026-04-10	2026-04-17	13.29	-17.92	0.00	0.00	0.00	0.00	debt	\N	\N	\N	\N	\N	\N	2026-04-17 21:49:19.015363	-0.20	-84.38	-96.16	\N	0.00	2599609	-84.38	84.38	0.00	84.38
0f766e17-1db0-467b-8b24-a29f0883a0d3	322e3576-685b-4a3b-9975-152c39ee7c03	46bcf8c1-2326-49a1-a4bc-388eff6d775e	2026-04-10	2026-04-17	206.08	-38.56	0.00	0.00	0.00	0.00	debt	\N	\N	\N	\N	\N	\N	2026-04-17 21:49:19.015363	-3.09	-94.02	-316.28	\N	0.00	4422610	-94.02	94.02	39.72	54.30
cdce3400-4328-46a3-aa60-a52403231e1d	322e3576-685b-4a3b-9975-152c39ee7c03	46bcf8c1-2326-49a1-a4bc-388eff6d775e	2026-04-16	2026-04-23	44.80	4.41	0.00	0.00	0.00	0.00	pending	\N	\N	\N	\N	\N	\N	2026-04-23 20:30:22.583661	-0.67	39.72	0.00	\N	0.00	4422610	39.72	0.00	39.72	0.00
\.


--
-- TOC entry 3718 (class 0 OID 16432)
-- Dependencies: 217
-- Data for Name: drivers; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.drivers (id, organization_id, user_id, first_name, last_name, email, phone, date_of_birth, address, license_number, license_expiry, license_class, hire_date, employment_status, commission_rate, base_commission_rate, uber_driver_id, bolt_driver_id, notes, created_at, updated_at, is_deleted, deleted_at, deleted_by, commission_type, fixed_commission_amount, minimum_commission, glovo_courier_id, bolt_courier_id, current_vehicle_id, profile_photo_url, profile_photo_updated_at, wolt_courier_id, wolt_courier_verified, wolt_courier_verified_at) FROM stdin;
f3cba0eb-b71f-4113-bc1c-ea59dda99c20	322e3576-685b-4a3b-9975-152c39ee7c03	\N	Muhammad	Bilal	bilaljutt4349@gmail.com	0723094185	1997-01-22	Drumul Gura Solcii nr 50	\N	\N	\N	2026-01-20	active	10.00	\N	a28b0349-8011-4939-b60c-ca9d8e0a8dd4	Muhammad Bilal	Start Work from 1 februray	2026-03-27 16:18:52.413331	2026-04-16 15:20:41.884987	f	\N	\N	percentage	0.00	0.00	2599609	\N	\N	\N	\N	\N	f	\N
46bcf8c1-2326-49a1-a4bc-388eff6d775e	322e3576-685b-4a3b-9975-152c39ee7c03	\N	Abbas	Touqeer	haiderjutt9238@gmail.com	072924820	1996-12-28	Sector 5	\N	\N	\N	\N	active	10.00	\N	\N	\N	\N	2026-04-07 20:51:05.958478	2026-04-16 15:20:57.858578	f	\N	\N	percentage	0.00	0.00	4422610	\N	\N	\N	\N	\N	f	\N
1fcb6e17-96dc-4dba-9ef2-9f48444b2749	322e3576-685b-4a3b-9975-152c39ee7c03	\N	Arshad	Uzair	afatbhassan612@gmail.com	0728372903	2004-01-27	Sector 4	\N	\N	\N	\N	active	15.00	\N	4296794	\N	\N	2026-04-08 16:43:37.099044	2026-04-17 13:08:38.193664	f	\N	\N	percentage	0.00	0.00	3777223	\N	\N	\N	\N	\N	f	\N
\.


--
-- TOC entry 3729 (class 0 OID 33140)
-- Dependencies: 231
-- Data for Name: earnings_import_staging; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.earnings_import_staging (id, organization_id, import_id, row_index, payload, created_at) FROM stdin;
0156d634-17db-4fda-8f6a-c6ac2d0b1d92	322e3576-685b-4a3b-9975-152c39ee7c03	522d6a06-b93d-4e1d-be89-807408788f4b	0	{"hints": {"courierId": "2599609"}, "amounts": {"net": 13.489999999999998, "gross": 13.29, "dailyCash": -96.16, "tripCount": 0, "platformFee": -0.2, "transferTotal": -83.071214, "accountOpeningFee": null}, "rawSample": {"gross": "13.29", "trips": "0", "courier_id": "2599609", "daily_cash": "-96.16", "platform_fee": "-0.2", "transfer_total": "-83.071214"}, "tripDateIso": null}	2026-04-17 22:21:13.216125
136698b4-e6ed-4d24-a1f0-9691722eab4a	322e3576-685b-4a3b-9975-152c39ee7c03	522d6a06-b93d-4e1d-be89-807408788f4b	1	{"hints": {"courierId": "4422610"}, "amounts": {"net": 209.17000000000002, "gross": 206.08, "dailyCash": -316.28, "tripCount": 0, "platformFee": -3.09, "transferTotal": -69.320352, "accountOpeningFee": null}, "rawSample": {"gross": "206.08", "trips": "0", "courier_id": "4422610", "daily_cash": "-316.28", "platform_fee": "-3.09", "transfer_total": "-69.320352"}, "tripDateIso": null}	2026-04-17 22:21:13.216125
5fc3b691-4125-436d-b532-8d1a82edc3e6	322e3576-685b-4a3b-9975-152c39ee7c03	522d6a06-b93d-4e1d-be89-807408788f4b	2	{"hints": {"courierId": "3777223"}, "amounts": {"net": 608.42, "gross": 599.43, "dailyCash": -117.67, "tripCount": 0, "platformFee": -8.99, "transferTotal": 552.610346, "accountOpeningFee": null}, "rawSample": {"gross": "599.43", "trips": "0", "courier_id": "3777223", "daily_cash": "-117.67", "platform_fee": "-8.99", "transfer_total": "552.610346"}, "tripDateIso": null}	2026-04-17 22:21:13.216125
\.


--
-- TOC entry 3722 (class 0 OID 16589)
-- Dependencies: 222
-- Data for Name: earnings_imports; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.earnings_imports (id, organization_id, file_name, import_date, week_start, week_end, platform, total_gross, total_trips, record_count, imported_by, created_at, status, detection_meta) FROM stdin;
3d5a92af-2f5b-474f-bb42-438726880fe1	322e3576-685b-4a3b-9975-152c39ee7c03	EYMANOR REPORTS_Staging.xlsx	2026-04-17	2026-04-10	2026-04-17	glovo	818.80	0	3	0b070cf9-3d06-4bff-af41-b0ae7591e027	2026-04-17 21:49:15.428066	completed	{"rowCount": 3, "headerCount": 11, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 1}
522d6a06-b93d-4e1d-be89-807408788f4b	322e3576-685b-4a3b-9975-152c39ee7c03	EYMANOR REPORTS_Staging.xlsx	2026-04-17	2026-04-17	2026-04-17	glovo	\N	\N	\N	0b070cf9-3d06-4bff-af41-b0ae7591e027	2026-04-17 22:21:13.216125	preview	{"rowCount": 3, "headerCount": 11, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 1}
8ba2d232-e6e1-49f1-8495-4b659ba5ead1	322e3576-685b-4a3b-9975-152c39ee7c03	Single_GlovoData - Balance Adjustment.xlsx	2026-04-23	2026-04-16	2026-04-23	glovo	44.80	1	1	0b070cf9-3d06-4bff-af41-b0ae7591e027	2026-04-23 20:29:52.759237	completed	{"rowCount": 1, "headerCount": 11, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 1}
\.


--
-- TOC entry 3723 (class 0 OID 16607)
-- Dependencies: 223
-- Data for Name: earnings_records; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.earnings_records (id, import_id, driver_id, platform, trip_date, trip_count, gross_earnings, platform_fee, net_earnings, company_commission, driver_payout, commission_type, created_at, total_transfer_earnings, daily_cash, transfer_commission, cash_commission, account_opening_fee, vehicle_rental_id, vehicle_rental_fee) FROM stdin;
c260f48d-32d1-4515-8209-0b304f23b264	3d5a92af-2f5b-474f-bb42-438726880fe1	f3cba0eb-b71f-4113-bc1c-ea59dda99c20	glovo	2026-04-17	0	13.29	-0.20	-84.38	-17.92	-84.38	percentage	2026-04-17 21:49:19.015363	-83.07	-96.16	-8.31	-9.62	\N	\N	\N
a34b9d4f-7f37-40dc-87b0-d836adb9497a	3d5a92af-2f5b-474f-bb42-438726880fe1	46bcf8c1-2326-49a1-a4bc-388eff6d775e	glovo	2026-04-17	0	206.08	-3.09	-94.02	-38.56	-94.02	percentage	2026-04-17 21:49:19.015363	-69.32	-316.28	-6.93	-31.63	\N	\N	\N
f00cfc32-ce26-46e4-badd-680668454af9	3d5a92af-2f5b-474f-bb42-438726880fe1	1fcb6e17-96dc-4dba-9ef2-9f48444b2749	glovo	2026-04-17	0	599.43	-8.99	452.07	65.24	452.07	percentage	2026-04-17 21:49:19.015363	552.61	-117.67	82.89	-17.65	\N	\N	\N
e43c2f9a-682c-4e89-8f9e-89651a453c5b	8ba2d232-e6e1-49f1-8495-4b659ba5ead1	46bcf8c1-2326-49a1-a4bc-388eff6d775e	glovo	2026-04-23	\N	44.80	-0.67	39.72	4.41	39.72	percentage	2026-04-23 20:30:22.583661	44.13	\N	4.41	0.00	\N	\N	\N
\.


--
-- TOC entry 3716 (class 0 OID 16400)
-- Dependencies: 215
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.organizations (id, name, email, phone, address, logo_url, settings, created_at, updated_at, commission_rate) FROM stdin;
322e3576-685b-4a3b-9975-152c39ee7c03	Eyemamor	muhammadikramjnd@gmail.com	\N	\N	\N	{}	2026-03-05 17:57:03.135341	2026-03-05 17:57:03.135341	0.1000
\.


--
-- TOC entry 3732 (class 0 OID 57751)
-- Dependencies: 235
-- Data for Name: payout_adjustments; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.payout_adjustments (id, organization_id, payout_id, amount, reason, adjustment_type, created_by, created_at) FROM stdin;
\.


--
-- TOC entry 3717 (class 0 OID 16413)
-- Dependencies: 216
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.users (id, organization_id, email, password_hash, first_name, last_name, phone, role, avatar_url, is_active, last_login, created_at, updated_at) FROM stdin;
0b070cf9-3d06-4bff-af41-b0ae7591e027	322e3576-685b-4a3b-9975-152c39ee7c03	muhammadikramjnd@gmail.com	$2b$10$duOsSP2/J3/QEvT3dPDVlOczkmtxZtwW2oOqiFmACockRposWYw16	Eyemamor	Admin	\N	admin	\N	t	\N	2026-03-05 17:57:03.135341	2026-03-05 17:57:03.135341
\.


--
-- TOC entry 3727 (class 0 OID 16751)
-- Dependencies: 229
-- Data for Name: vehicle_documents; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.vehicle_documents (id, vehicle_id, organization_id, document_type, document_number, file_name, file_path, file_size, expiry_date, issue_date, is_verified, verified_by, verified_at, notes, uploaded_by, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3726 (class 0 OID 16723)
-- Dependencies: 228
-- Data for Name: vehicle_maintenance; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.vehicle_maintenance (id, vehicle_id, maintenance_type, description, cost, scheduled_date, completed_date, status, mechanic_name, notes, created_at, updated_at) FROM stdin;
ee865cd8-c06d-49e1-bbd8-ecb87de8618e	8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51	Body	Bumper damage	50.00	2026-03-28	\N	in_progress	solo	\N	2026-03-27 16:32:13.882235	2026-03-27 16:32:13.882235
\.


--
-- TOC entry 3725 (class 0 OID 16686)
-- Dependencies: 227
-- Data for Name: vehicle_rentals; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.vehicle_rentals (id, vehicle_id, driver_id, organization_id, rental_start_date, rental_end_date, rental_type, total_rent_amount, deposit_amount, payment_status, payment_date, payment_method, payment_reference, status, notes, created_by, created_at, updated_at, deposit_status, deposit_paid_at, deposit_refunded_at, deposit_deduction_amount, deposit_deduction_reason) FROM stdin;
\.


--
-- TOC entry 3724 (class 0 OID 16659)
-- Dependencies: 226
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: fleetadmin
--

COPY public.vehicles (id, organization_id, vehicle_type, make, model, year, color, license_plate, vin, fuel_type, transmission, seating_capacity, daily_rent, weekly_rent, monthly_rent, insurance_expiry, registration_expiry, status, current_driver_id, notes, created_at, updated_at) FROM stdin;
8e97b6f6-a8d8-46c0-bf8e-eeb816b19a51	322e3576-685b-4a3b-9975-152c39ee7c03	car	Hyundai	sonoto	2021	RED	B122pal	94569579458	Petrol	Auto	\N	0.00	600.00	0.00	2026-06-14	2027-04-11	available	\N	\N	2026-03-27 16:20:09.719936	2026-04-15 23:34:46.971248
\.


--
-- TOC entry 3511 (class 2606 OID 24997)
-- Name: deposit_transactions deposit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 3475 (class 2606 OID 16497)
-- Name: driver_activities driver_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_pkey PRIMARY KEY (id);


--
-- TOC entry 3470 (class 2606 OID 16467)
-- Name: driver_documents driver_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);


--
-- TOC entry 3479 (class 2606 OID 16548)
-- Name: driver_payouts driver_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_pkey PRIMARY KEY (id);


--
-- TOC entry 3460 (class 2606 OID 16445)
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- TOC entry 3516 (class 2606 OID 33148)
-- Name: earnings_import_staging earnings_import_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_import_staging
    ADD CONSTRAINT earnings_import_staging_pkey PRIMARY KEY (id);


--
-- TOC entry 3484 (class 2606 OID 16596)
-- Name: earnings_imports earnings_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_pkey PRIMARY KEY (id);


--
-- TOC entry 3486 (class 2606 OID 16613)
-- Name: earnings_records earnings_records_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_pkey PRIMARY KEY (id);


--
-- TOC entry 3450 (class 2606 OID 16412)
-- Name: organizations organizations_email_key; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_email_key UNIQUE (email);


--
-- TOC entry 3452 (class 2606 OID 16410)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- TOC entry 3522 (class 2606 OID 57760)
-- Name: payout_adjustments payout_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_pkey PRIMARY KEY (id);


--
-- TOC entry 3456 (class 2606 OID 16426)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 3458 (class 2606 OID 16424)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3509 (class 2606 OID 16761)
-- Name: vehicle_documents vehicle_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_pkey PRIMARY KEY (id);


--
-- TOC entry 3506 (class 2606 OID 16734)
-- Name: vehicle_maintenance vehicle_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_maintenance
    ADD CONSTRAINT vehicle_maintenance_pkey PRIMARY KEY (id);


--
-- TOC entry 3502 (class 2606 OID 16702)
-- Name: vehicle_rentals vehicle_rentals_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_pkey PRIMARY KEY (id);


--
-- TOC entry 3493 (class 2606 OID 16675)
-- Name: vehicles vehicles_license_plate_key; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_license_plate_key UNIQUE (license_plate);


--
-- TOC entry 3495 (class 2606 OID 16673)
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- TOC entry 3512 (class 1259 OID 25015)
-- Name: idx_deposit_transactions_date; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_deposit_transactions_date ON public.deposit_transactions USING btree (transaction_date);


--
-- TOC entry 3513 (class 1259 OID 25013)
-- Name: idx_deposit_transactions_rental; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_deposit_transactions_rental ON public.deposit_transactions USING btree (rental_id);


--
-- TOC entry 3514 (class 1259 OID 25014)
-- Name: idx_deposit_transactions_status; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_deposit_transactions_status ON public.deposit_transactions USING btree (payment_status);


--
-- TOC entry 3476 (class 1259 OID 16509)
-- Name: idx_driver_activities_created; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_activities_created ON public.driver_activities USING btree (created_at DESC);


--
-- TOC entry 3477 (class 1259 OID 16508)
-- Name: idx_driver_activities_driver; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_activities_driver ON public.driver_activities USING btree (driver_id);


--
-- TOC entry 3471 (class 1259 OID 16487)
-- Name: idx_driver_documents_driver; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_documents_driver ON public.driver_documents USING btree (driver_id);


--
-- TOC entry 3472 (class 1259 OID 16515)
-- Name: idx_driver_documents_organization; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_documents_organization ON public.driver_documents USING btree (organization_id);


--
-- TOC entry 3473 (class 1259 OID 16488)
-- Name: idx_driver_documents_type; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_documents_type ON public.driver_documents USING btree (document_type);


--
-- TOC entry 3480 (class 1259 OID 33161)
-- Name: idx_driver_payouts_org_driver_period; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE UNIQUE INDEX idx_driver_payouts_org_driver_period ON public.driver_payouts USING btree (organization_id, driver_id, payment_period_start, payment_period_end);


--
-- TOC entry 3481 (class 1259 OID 16624)
-- Name: idx_driver_payouts_period; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_payouts_period ON public.driver_payouts USING btree (payment_period_start, payment_period_end);


--
-- TOC entry 3482 (class 1259 OID 57715)
-- Name: idx_driver_payouts_platform_id; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_driver_payouts_platform_id ON public.driver_payouts USING btree (platform_id);


--
-- TOC entry 3461 (class 1259 OID 16639)
-- Name: idx_drivers_bolt_courier_id; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_bolt_courier_id ON public.drivers USING btree (bolt_courier_id);


--
-- TOC entry 3462 (class 1259 OID 16748)
-- Name: idx_drivers_current_vehicle; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_current_vehicle ON public.drivers USING btree (current_vehicle_id);


--
-- TOC entry 3463 (class 1259 OID 16584)
-- Name: idx_drivers_is_deleted; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_is_deleted ON public.drivers USING btree (is_deleted);


--
-- TOC entry 3464 (class 1259 OID 16456)
-- Name: idx_drivers_org_license; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE UNIQUE INDEX idx_drivers_org_license ON public.drivers USING btree (organization_id, license_number) WHERE (license_number IS NOT NULL);


--
-- TOC entry 3465 (class 1259 OID 16485)
-- Name: idx_drivers_organization; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_organization ON public.drivers USING btree (organization_id);


--
-- TOC entry 3466 (class 1259 OID 16750)
-- Name: idx_drivers_profile_photo; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_profile_photo ON public.drivers USING btree (profile_photo_url);


--
-- TOC entry 3467 (class 1259 OID 16486)
-- Name: idx_drivers_status; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_status ON public.drivers USING btree (employment_status);


--
-- TOC entry 3468 (class 1259 OID 16784)
-- Name: idx_drivers_wolt_courier_id; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_drivers_wolt_courier_id ON public.drivers USING btree (wolt_courier_id);


--
-- TOC entry 3487 (class 1259 OID 49579)
-- Name: idx_earnings_records_vehicle_rental; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_earnings_records_vehicle_rental ON public.earnings_records USING btree (vehicle_rental_id) WHERE (vehicle_rental_id IS NOT NULL);


--
-- TOC entry 3517 (class 1259 OID 33159)
-- Name: idx_earnings_staging_import; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_earnings_staging_import ON public.earnings_import_staging USING btree (import_id);


--
-- TOC entry 3518 (class 1259 OID 33160)
-- Name: idx_earnings_staging_org; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_earnings_staging_org ON public.earnings_import_staging USING btree (organization_id);


--
-- TOC entry 3519 (class 1259 OID 57777)
-- Name: idx_payout_adjustments_org_created; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_payout_adjustments_org_created ON public.payout_adjustments USING btree (organization_id, created_at DESC);


--
-- TOC entry 3520 (class 1259 OID 57776)
-- Name: idx_payout_adjustments_org_payout; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_payout_adjustments_org_payout ON public.payout_adjustments USING btree (organization_id, payout_id);


--
-- TOC entry 3496 (class 1259 OID 24979)
-- Name: idx_rentals_driver; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_rentals_driver ON public.vehicle_rentals USING btree (driver_id);


--
-- TOC entry 3497 (class 1259 OID 24974)
-- Name: idx_rentals_status; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_rentals_status ON public.vehicle_rentals USING btree (status);


--
-- TOC entry 3498 (class 1259 OID 24975)
-- Name: idx_rentals_vehicle; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_rentals_vehicle ON public.vehicle_rentals USING btree (vehicle_id);


--
-- TOC entry 3453 (class 1259 OID 16483)
-- Name: idx_users_organization; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_users_organization ON public.users USING btree (organization_id);


--
-- TOC entry 3454 (class 1259 OID 16484)
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- TOC entry 3507 (class 1259 OID 16782)
-- Name: idx_vehicle_documents_organization; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicle_documents_organization ON public.vehicle_documents USING btree (organization_id);


--
-- TOC entry 3503 (class 1259 OID 16742)
-- Name: idx_vehicle_maintenance_status; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicle_maintenance_status ON public.vehicle_maintenance USING btree (status);


--
-- TOC entry 3504 (class 1259 OID 16740)
-- Name: idx_vehicle_maintenance_vehicle; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicle_maintenance_vehicle ON public.vehicle_maintenance USING btree (vehicle_id);


--
-- TOC entry 3499 (class 1259 OID 24980)
-- Name: idx_vehicle_rentals_organization; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicle_rentals_organization ON public.vehicle_rentals USING btree (organization_id);


--
-- TOC entry 3500 (class 1259 OID 16749)
-- Name: idx_vehicle_rentals_period; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicle_rentals_period ON public.vehicle_rentals USING btree (rental_start_date, rental_end_date);


--
-- TOC entry 3488 (class 1259 OID 24973)
-- Name: idx_vehicles_current_driver; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicles_current_driver ON public.vehicles USING btree (current_driver_id);


--
-- TOC entry 3489 (class 1259 OID 24978)
-- Name: idx_vehicles_license_plate; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicles_license_plate ON public.vehicles USING btree (license_plate);


--
-- TOC entry 3490 (class 1259 OID 24976)
-- Name: idx_vehicles_organization; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicles_organization ON public.vehicles USING btree (organization_id);


--
-- TOC entry 3491 (class 1259 OID 24977)
-- Name: idx_vehicles_status; Type: INDEX; Schema: public; Owner: fleetadmin
--

CREATE INDEX idx_vehicles_status ON public.vehicles USING btree (status);


--
-- TOC entry 3568 (class 2620 OID 49581)
-- Name: earnings_records trg_earnings_records_match_vehicle_rental; Type: TRIGGER; Schema: public; Owner: fleetadmin
--

CREATE TRIGGER trg_earnings_records_match_vehicle_rental BEFORE INSERT OR UPDATE OF driver_id, trip_date ON public.earnings_records FOR EACH ROW EXECUTE FUNCTION public.earnings_records_match_vehicle_rental();


--
-- TOC entry 3569 (class 2620 OID 57750)
-- Name: earnings_records trg_earnings_records_payout_after_cash; Type: TRIGGER; Schema: public; Owner: fleetadmin
--

CREATE TRIGGER trg_earnings_records_payout_after_cash BEFORE INSERT OR UPDATE OF total_transfer_earnings, net_earnings, gross_earnings, platform_fee, transfer_commission, cash_commission, company_commission ON public.earnings_records FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_driver_payout_after_cash();


--
-- TOC entry 3560 (class 2606 OID 25008)
-- Name: deposit_transactions deposit_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 3561 (class 2606 OID 25003)
-- Name: deposit_transactions deposit_transactions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3562 (class 2606 OID 24998)
-- Name: deposit_transactions deposit_transactions_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.deposit_transactions
    ADD CONSTRAINT deposit_transactions_rental_id_fkey FOREIGN KEY (rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE CASCADE;


--
-- TOC entry 3533 (class 2606 OID 16498)
-- Name: driver_activities driver_activities_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3534 (class 2606 OID 16503)
-- Name: driver_activities driver_activities_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_activities
    ADD CONSTRAINT driver_activities_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- TOC entry 3529 (class 2606 OID 16468)
-- Name: driver_documents driver_documents_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3530 (class 2606 OID 16510)
-- Name: driver_documents driver_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3531 (class 2606 OID 16478)
-- Name: driver_documents driver_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 3532 (class 2606 OID 16473)
-- Name: driver_documents driver_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- TOC entry 3535 (class 2606 OID 16559)
-- Name: driver_payouts driver_payments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- TOC entry 3536 (class 2606 OID 16554)
-- Name: driver_payouts driver_payments_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id);


--
-- TOC entry 3537 (class 2606 OID 16549)
-- Name: driver_payouts driver_payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- TOC entry 3538 (class 2606 OID 49574)
-- Name: driver_payouts driver_payouts_vehicle_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payouts_vehicle_rental_id_fkey FOREIGN KEY (vehicle_rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE SET NULL;


--
-- TOC entry 3524 (class 2606 OID 16743)
-- Name: drivers drivers_current_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_current_vehicle_id_fkey FOREIGN KEY (current_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- TOC entry 3525 (class 2606 OID 16579)
-- Name: drivers drivers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- TOC entry 3526 (class 2606 OID 16446)
-- Name: drivers drivers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3527 (class 2606 OID 16451)
-- Name: drivers drivers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 3563 (class 2606 OID 33154)
-- Name: earnings_import_staging earnings_import_staging_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_import_staging
    ADD CONSTRAINT earnings_import_staging_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.earnings_imports(id) ON DELETE CASCADE;


--
-- TOC entry 3564 (class 2606 OID 33149)
-- Name: earnings_import_staging earnings_import_staging_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_import_staging
    ADD CONSTRAINT earnings_import_staging_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3539 (class 2606 OID 16602)
-- Name: earnings_imports earnings_imports_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(id);


--
-- TOC entry 3540 (class 2606 OID 16597)
-- Name: earnings_imports earnings_imports_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_imports
    ADD CONSTRAINT earnings_imports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3541 (class 2606 OID 16619)
-- Name: earnings_records earnings_records_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3542 (class 2606 OID 16614)
-- Name: earnings_records earnings_records_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.earnings_imports(id) ON DELETE CASCADE;


--
-- TOC entry 3543 (class 2606 OID 49568)
-- Name: earnings_records earnings_records_vehicle_rental_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.earnings_records
    ADD CONSTRAINT earnings_records_vehicle_rental_id_fkey FOREIGN KEY (vehicle_rental_id) REFERENCES public.vehicle_rentals(id) ON DELETE SET NULL;


--
-- TOC entry 3528 (class 2606 OID 24943)
-- Name: drivers fk_drivers_organization; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT fk_drivers_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3548 (class 2606 OID 24963)
-- Name: vehicle_rentals fk_rentals_driver; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT fk_rentals_driver FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3549 (class 2606 OID 24968)
-- Name: vehicle_rentals fk_rentals_organization; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT fk_rentals_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3550 (class 2606 OID 24958)
-- Name: vehicle_rentals fk_rentals_vehicle; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT fk_rentals_vehicle FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3544 (class 2606 OID 24953)
-- Name: vehicles fk_vehicles_current_driver; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT fk_vehicles_current_driver FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- TOC entry 3545 (class 2606 OID 24948)
-- Name: vehicles fk_vehicles_organization; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT fk_vehicles_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3565 (class 2606 OID 57771)
-- Name: payout_adjustments payout_adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 3566 (class 2606 OID 57761)
-- Name: payout_adjustments payout_adjustments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3567 (class 2606 OID 57766)
-- Name: payout_adjustments payout_adjustments_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.driver_payouts(id) ON DELETE CASCADE;


--
-- TOC entry 3523 (class 2606 OID 16427)
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- TOC entry 3556 (class 2606 OID 16767)
-- Name: vehicle_documents vehicle_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3557 (class 2606 OID 16777)
-- Name: vehicle_documents vehicle_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- TOC entry 3558 (class 2606 OID 16762)
-- Name: vehicle_documents vehicle_documents_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3559 (class 2606 OID 16772)
-- Name: vehicle_documents vehicle_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_documents
    ADD CONSTRAINT vehicle_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- TOC entry 3555 (class 2606 OID 16735)
-- Name: vehicle_maintenance vehicle_maintenance_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_maintenance
    ADD CONSTRAINT vehicle_maintenance_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3551 (class 2606 OID 16718)
-- Name: vehicle_rentals vehicle_rentals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- TOC entry 3552 (class 2606 OID 16708)
-- Name: vehicle_rentals vehicle_rentals_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- TOC entry 3553 (class 2606 OID 16713)
-- Name: vehicle_rentals vehicle_rentals_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- TOC entry 3554 (class 2606 OID 16703)
-- Name: vehicle_rentals vehicle_rentals_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicle_rentals
    ADD CONSTRAINT vehicle_rentals_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- TOC entry 3546 (class 2606 OID 16681)
-- Name: vehicles vehicles_current_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_current_driver_id_fkey FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- TOC entry 3547 (class 2606 OID 16676)
-- Name: vehicles vehicles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fleetadmin
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


-- Completed on 2026-04-24 03:15:18

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

-- Dumped from database version 15.17 (Debian 15.17-1.pgdg13+1)
-- Dumped by pg_dump version 15.3

-- Started on 2026-04-24 03:15:18

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

-- Completed on 2026-04-24 03:15:19

--
-- PostgreSQL database dump complete
--

-- Completed on 2026-04-24 03:15:19

--
-- PostgreSQL database cluster dump complete
--

