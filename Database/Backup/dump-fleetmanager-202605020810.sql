--
-- PostgreSQL database cluster dump
--

-- Started on 2026-05-02 08:10:50

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

-- Started on 2026-05-02 08:10:50

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


-- Completed on 2026-05-02 08:10:54

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

-- Started on 2026-05-02 08:10:54

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
4ce1803c-f95f-469f-b251-473ddf826717	b056757f-95bf-42ea-9c7e-3f75e459b726	85e400cf-9b36-4ae3-ade6-13302a38d4ed	2026-04-06	2026-04-12	724.24	-10.86	382.76	8.48	0.00	0.00	0.00	382.76	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-339.59	\N	0.00	4272517	382.76	0.00	0.00	0.00
972c1ba6-bef8-4e66-8050-9e89e50d93eb	b056757f-95bf-42ea-9c7e-3f75e459b726	34ae1ec3-6f90-4898-9418-e9535c691ff2	2026-04-06	2026-04-12	691.71	-10.38	716.16	79.57	0.00	0.00	0.00	716.16	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	4494353	716.16	0.00	0.00	0.00
723dc08e-0b7c-4623-832d-fe71c3f8a82b	b056757f-95bf-42ea-9c7e-3f75e459b726	0ca3b8ed-0d55-4bff-957e-b453a12105cc	2026-04-06	2026-04-12	13.29	-0.20	-83.73	-8.96	0.00	0.00	0.00	0.00	debt	\N	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-96.16	\N	0.00	2599609	-83.73	83.73	83.73	0.00
8d873370-05de-4124-a3ea-8f36442c71fe	b056757f-95bf-42ea-9c7e-3f75e459b726	4d7d391b-bf01-488f-b001-80cb7057b696	2026-04-06	2026-04-12	206.08	-3.09	-94.02	-38.56	0.00	0.00	0.00	0.00	debt	\N	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-316.28	\N	0.00	4422610	-94.02	94.02	94.02	0.00
fe844f4e-ca36-4a1a-a968-cd4165cc9843	b056757f-95bf-42ea-9c7e-3f75e459b726	923fc82e-4730-47cb-ba9e-a8af9e9251cb	2026-04-06	2026-04-12	797.91	-11.97	764.60	52.99	0.00	0.00	0.00	764.60	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-184.74	\N	0.00	3871294	764.60	0.00	0.00	0.00
233201bc-45b7-4d31-92e0-b4fcddc99cc4	b056757f-95bf-42ea-9c7e-3f75e459b726	15cbbadf-c84d-435f-8393-30bdcca08c81	2026-04-06	2026-04-12	1368.60	-20.53	1258.01	116.89	0.00	0.00	0.00	1258.01	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-92.86	\N	0.00	4150354	1258.01	0.00	0.00	0.00
68e3766d-69cd-4f49-8337-cf35fb32c6c3	b056757f-95bf-42ea-9c7e-3f75e459b726	5fee9303-c9e0-4c93-8d0b-e80daf790f69	2026-04-06	2026-04-12	2430.96	-36.46	1843.24	117.46	0.00	0.00	0.00	1843.24	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-586.27	\N	0.00	4375552	1843.24	0.00	0.00	0.00
db5603fe-3e17-48e4-890d-d0e75a1a52c8	b056757f-95bf-42ea-9c7e-3f75e459b726	3ab8471a-bafe-432e-acd3-76f09b88f3cf	2026-04-06	2026-04-12	599.43	-8.99	492.29	39.14	0.00	0.00	0.00	492.29	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-117.67	\N	0.00	3777223	492.29	0.00	0.00	0.00
81937541-b257-4c45-9792-b41dd33d3909	b056757f-95bf-42ea-9c7e-3f75e459b726	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	2026-04-06	2026-04-12	796.93	-11.95	761.22	84.38	0.00	0.00	0.00	761.22	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-2.29	\N	0.00	2311096	761.22	0.00	0.00	0.00
b0cfd8d8-3b26-45bc-a31b-d301c5b591d8	b056757f-95bf-42ea-9c7e-3f75e459b726	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	2026-04-06	2026-04-12	620.93	-9.31	241.64	-3.26	0.00	0.00	0.00	241.64	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-332.23	\N	0.00	3802716	241.64	0.00	0.00	0.00
a47af7ec-152e-4954-b327-2b47e9ff770c	b056757f-95bf-42ea-9c7e-3f75e459b726	89dd665f-5fac-40a3-8df6-667e78d80ac7	2026-04-06	2026-04-12	772.63	-11.59	508.37	25.83	0.00	0.00	0.00	508.37	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-251.62	\N	0.00	4340056	508.37	0.00	0.00	0.00
e74a0a5d-e33a-4da5-939c-e6645d652d01	b056757f-95bf-42ea-9c7e-3f75e459b726	40b8b06a-aeef-445d-8de5-549939e33f17	2026-04-06	2026-04-12	867.80	-13.02	753.24	74.71	0.00	0.00	0.00	753.24	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-101.02	\N	0.00	4375550	753.24	0.00	0.00	0.00
fc7bf794-c591-4740-b6cb-4f866bf06a31	b056757f-95bf-42ea-9c7e-3f75e459b726	277d19f6-4a38-4909-9ddb-d1e83de5e014	2026-04-06	2026-04-12	1115.27	-16.73	1129.85	93.90	0.00	0.00	0.00	1129.85	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-59.53	\N	0.00	4466674	1129.85	0.00	0.00	0.00
4e6f939b-0703-4a81-9145-a7ab250b37fb	b056757f-95bf-42ea-9c7e-3f75e459b726	11086bf8-3977-4f3d-8116-8c006cef839a	2026-04-06	2026-04-12	1873.38	-28.10	1927.33	167.59	0.00	0.00	0.00	1927.33	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	3820899	1927.33	0.00	0.00	0.00
e3caccef-94f0-4be0-9754-2df7dab79e3a	b056757f-95bf-42ea-9c7e-3f75e459b726	0b126711-4db1-4eba-9255-0ec8719d2acb	2026-04-06	2026-04-12	1453.10	-21.80	1276.38	116.19	0.00	0.00	0.00	1276.38	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-123.82	\N	0.00	2828721	1276.38	0.00	0.00	0.00
0aaa06a4-b377-4b96-93f2-fadd7184e588	b056757f-95bf-42ea-9c7e-3f75e459b726	dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	2026-04-06	2026-04-12	566.32	-8.49	455.14	37.48	0.00	0.00	0.00	455.14	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-92.87	\N	0.00	4505047	455.14	0.00	0.00	0.00
0f5e4805-1a8e-421a-9a57-3a3bf0990584	b056757f-95bf-42ea-9c7e-3f75e459b726	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	2026-04-06	2026-04-12	3388.47	-50.83	3455.73	383.97	0.00	0.00	0.00	3455.73	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	4505090	3455.73	0.00	0.00	0.00
17b573ed-54a4-4983-87da-8ff4a576611d	b056757f-95bf-42ea-9c7e-3f75e459b726	3e99e189-5c59-4748-af33-132778fe46d9	2026-04-06	2026-04-12	543.32	-8.15	579.70	50.41	0.00	0.00	0.00	579.70	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	4272617	579.70	0.00	0.00	0.00
603d8314-1d76-4d2f-a4fb-3c9f7f7d5db3	b056757f-95bf-42ea-9c7e-3f75e459b726	64d26978-b842-4b70-95b9-8cbdcc08e2f5	2026-04-06	2026-04-12	1047.68	-15.72	983.32	121.54	0.00	0.00	0.00	983.32	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	3776255	983.32	0.00	0.00	0.00
939c3b2c-b7e5-42e4-ae93-0387359bbcfa	b056757f-95bf-42ea-9c7e-3f75e459b726	bdbdf261-cc6c-4ccc-8815-cb9787e437dc	2026-04-06	2026-04-12	1408.63	-21.13	1417.67	140.21	0.00	0.00	0.00	1417.67	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	4501478	1417.67	0.00	0.00	0.00
2432ba03-c95a-4828-9606-4248d9396c7d	b056757f-95bf-42ea-9c7e-3f75e459b726	23390533-03be-4c9e-a5e3-c84e1ecc268c	2026-04-06	2026-04-12	2314.65	-34.72	2419.31	239.27	0.00	0.00	0.00	2419.31	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	4505067	2419.31	0.00	0.00	0.00
125371a1-a7bb-497f-8f34-3b69136753dc	b056757f-95bf-42ea-9c7e-3f75e459b726	15cbbadf-c84d-435f-8393-30bdcca08c81	2026-04-13	2026-04-19	1402.41	-21.04	1356.47	134.16	0.00	0.00	0.00	1356.47	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4150354	1356.47	0.00	0.00	0.00
15bea7d0-e602-4fe5-9876-46f4966ac6a8	b056757f-95bf-42ea-9c7e-3f75e459b726	c2bdb349-2e52-4adb-9044-b6c683c2ab13	2026-04-13	2026-04-19	549.08	-8.24	469.38	51.26	0.00	0.00	0.00	469.38	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-70.01	\N	0.00	4492805	469.38	0.00	0.00	0.00
52e64b93-b1f1-47d8-9d58-13740b8246f0	b056757f-95bf-42ea-9c7e-3f75e459b726	64d26978-b842-4b70-95b9-8cbdcc08e2f5	2026-04-13	2026-04-19	1603.89	-24.06	1628.58	201.28	0.00	0.00	0.00	1628.58	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	3776255	1628.58	0.00	0.00	0.00
4ae8e488-cdc2-4c76-a68e-069395046a14	b056757f-95bf-42ea-9c7e-3f75e459b726	4d7d391b-bf01-488f-b001-80cb7057b696	2026-04-13	2026-04-19	268.58	-4.03	299.84	33.32	0.00	0.00	0.00	205.82	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4422610	299.84	0.00	94.02	0.00
3384acfc-0f13-4f32-9711-cd73de8ba253	b056757f-95bf-42ea-9c7e-3f75e459b726	0ca3b8ed-0d55-4bff-957e-b453a12105cc	2026-04-13	2026-04-19	286.21	-4.29	303.05	14.96	0.00	0.00	0.00	219.32	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-20.98	\N	0.00	2599609	303.05	0.00	83.73	0.00
c98cb3b1-e3e4-4226-a2b6-a127333add0f	b056757f-95bf-42ea-9c7e-3f75e459b726	8666eb6b-dc03-4c2a-a786-43d715b57f40	2026-04-06	2026-04-12	305.75	-4.59	165.34	9.43	0.00	0.00	0.00	165.34	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-114.12	\N	0.00	4150378	165.34	0.00	0.00	0.00
906427d3-c496-49eb-b6f1-5e5920d4d36f	b056757f-95bf-42ea-9c7e-3f75e459b726	3f662a2e-3e89-49f8-beed-fe533d22b00e	2026-04-06	2026-04-12	474.61	-7.12	59.41	-24.10	0.00	0.00	0.00	59.41	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-369.59	\N	0.00	2304573	59.41	0.00	0.00	0.00
459a29da-05df-42ed-bbc5-1b6741504ff6	b056757f-95bf-42ea-9c7e-3f75e459b726	5b18e6ec-238e-484b-808e-c3d5f1b74ac8	2026-04-06	2026-04-12	1378.64	-20.68	1353.95	129.97	0.00	0.00	0.00	1353.95	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-48.51	\N	0.00	2837774	1353.95	0.00	0.00	0.00
ce7470fd-ba5b-4819-9d34-dd8953e9873e	b056757f-95bf-42ea-9c7e-3f75e459b726	1f72fdc5-fb49-4b52-a23f-c69554dc5b30	2026-04-06	2026-04-12	1476.68	-22.15	1256.05	109.92	0.00	0.00	0.00	1256.05	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-176.40	\N	0.00	4492804	1256.05	0.00	0.00	0.00
ad0078df-fe4a-4501-a616-5816df74ffd9	b056757f-95bf-42ea-9c7e-3f75e459b726	6c4d01f6-5972-469a-83e5-36d9e49e91cf	2026-04-06	2026-04-12	1840.33	-27.60	1755.04	164.29	0.00	0.00	0.00	1755.04	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-114.43	\N	0.00	4492811	1755.04	0.00	0.00	0.00
be2b2520-f81c-466d-bd52-2c592194b991	b056757f-95bf-42ea-9c7e-3f75e459b726	eb5d629c-bf85-494a-beaf-6e66885b6bad	2026-04-06	2026-04-12	941.53	-14.12	983.45	109.27	0.00	0.00	0.00	983.45	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	0.00	\N	0.00	2657194	983.45	0.00	0.00	0.00
b3943291-232d-4c40-b633-3b015b534d4e	b056757f-95bf-42ea-9c7e-3f75e459b726	8081d690-38de-4fb9-bd34-cdc176c35865	2026-04-06	2026-04-12	993.18	-14.90	1019.30	109.11	0.00	0.00	0.00	1019.30	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:40:44.851985	-46.62	\N	0.00	2835207	1019.30	0.00	0.00	0.00
e26f4317-6a30-4f47-995b-d91b76a1fd58	b056757f-95bf-42ea-9c7e-3f75e459b726	3e99e189-5c59-4748-af33-132778fe46d9	2026-04-13	2026-04-19	759.57	-11.39	585.48	33.58	0.00	0.00	0.00	585.48	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-237.24	\N	0.00	4272617	585.48	0.00	0.00	0.00
03b31f92-6ede-4ce0-bfa3-372e368b9b58	b056757f-95bf-42ea-9c7e-3f75e459b726	11086bf8-3977-4f3d-8116-8c006cef839a	2026-04-13	2026-04-19	2195.60	-32.93	2305.83	200.51	0.00	0.00	0.00	2305.83	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	3820899	2305.83	0.00	0.00	0.00
c213648b-38b0-4a82-8ca8-3cd6de221449	b056757f-95bf-42ea-9c7e-3f75e459b726	923fc82e-4730-47cb-ba9e-a8af9e9251cb	2026-04-13	2026-04-19	941.68	-14.13	1049.03	91.22	0.00	0.00	0.00	1049.03	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	3871294	1049.03	0.00	0.00	0.00
4c6ac699-0a9e-4a41-8ce8-cf440abbc31c	b056757f-95bf-42ea-9c7e-3f75e459b726	5fee9303-c9e0-4c93-8d0b-e80daf790f69	2026-04-13	2026-04-19	3373.14	-50.60	2975.16	222.52	0.00	0.00	0.00	2975.16	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-495.43	\N	0.00	4375552	2975.16	0.00	0.00	0.00
51b7c0bd-2502-43bd-ae49-c61dc2a82527	b056757f-95bf-42ea-9c7e-3f75e459b726	277d19f6-4a38-4909-9ddb-d1e83de5e014	2026-04-13	2026-04-19	438.87	-6.58	71.36	-20.39	0.00	0.00	0.00	71.36	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-364.06	\N	0.00	4466674	71.36	0.00	0.00	0.00
18cec8f9-9b6f-4d52-8f50-34046ce3efb9	b056757f-95bf-42ea-9c7e-3f75e459b726	0b126711-4db1-4eba-9255-0ec8719d2acb	2026-04-13	2026-04-19	1818.15	-27.27	1755.73	173.64	0.00	0.00	0.00	1755.73	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	2828721	1755.73	0.00	0.00	0.00
59ff07bf-9558-4a30-8dec-260ab84a00b8	b056757f-95bf-42ea-9c7e-3f75e459b726	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	2026-04-13	2026-04-19	901.66	-13.52	693.64	46.18	0.00	0.00	0.00	693.64	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-193.48	\N	0.00	3802716	693.64	0.00	0.00	0.00
9e374a0e-6b01-4a0a-a341-5f39bed365ce	b056757f-95bf-42ea-9c7e-3f75e459b726	89dd665f-5fac-40a3-8df6-667e78d80ac7	2026-04-13	2026-04-19	1017.32	-15.26	1048.63	91.19	0.00	0.00	0.00	1048.63	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4340056	1048.63	0.00	0.00	0.00
d5cc97a8-5274-40f0-93a7-60c54f508dc2	b056757f-95bf-42ea-9c7e-3f75e459b726	dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	2026-04-13	2026-04-19	1301.47	-19.52	1059.74	89.56	0.00	0.00	0.00	1059.74	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-188.07	\N	0.00	4505047	1059.74	0.00	0.00	0.00
66415ef3-d51f-46a4-b269-7999a294ff03	b056757f-95bf-42ea-9c7e-3f75e459b726	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	2026-04-13	2026-04-19	1660.33	-24.90	1555.81	158.60	0.00	0.00	0.00	1555.81	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-160.52	\N	0.00	2311096	1555.81	0.00	0.00	0.00
09cffeec-3565-4810-ab1c-88fb8db8df4d	b056757f-95bf-42ea-9c7e-3f75e459b726	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	2026-04-13	2026-04-19	3722.94	-55.84	3536.75	385.27	0.00	0.00	0.00	3536.75	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-86.68	\N	0.00	4505090	3536.75	0.00	0.00	0.00
28287fc2-4f01-42fa-b56c-0360eb44a36a	b056757f-95bf-42ea-9c7e-3f75e459b726	40b8b06a-aeef-445d-8de5-549939e33f17	2026-04-13	2026-04-19	606.86	-9.10	664.76	73.86	0.00	0.00	0.00	664.76	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4375550	664.76	0.00	0.00	0.00
4b72fd20-379d-49e0-abfe-6dc5b8bcaa72	b056757f-95bf-42ea-9c7e-3f75e459b726	23390533-03be-4c9e-a5e3-c84e1ecc268c	2026-04-13	2026-04-19	1141.28	-17.12	1137.47	112.50	0.00	0.00	0.00	1137.47	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4505067	1137.47	0.00	0.00	0.00
03e5e065-0044-40b0-b804-eac86a7c8160	b056757f-95bf-42ea-9c7e-3f75e459b726	bdbdf261-cc6c-4ccc-8815-cb9787e437dc	2026-04-13	2026-04-19	1977.77	-29.67	2012.67	199.06	0.00	0.00	0.00	2012.67	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4501478	2012.67	0.00	0.00	0.00
e9855896-73e5-465e-ad51-b2ebfdfd2748	b056757f-95bf-42ea-9c7e-3f75e459b726	fedc175f-938e-4022-a4d8-463633357218	2026-04-13	2026-04-19	2168.14	-32.52	2228.21	220.37	0.00	0.00	0.00	2228.21	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4480947	2228.21	0.00	0.00	0.00
411fcaba-0353-41a2-b2ea-7b62ef188d42	b056757f-95bf-42ea-9c7e-3f75e459b726	34ae1ec3-6f90-4898-9418-e9535c691ff2	2026-04-13	2026-04-19	529.74	-7.95	336.14	19.98	0.00	0.00	0.00	336.14	pending	\N	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-195.34	\N	0.00	4494353	336.14	0.00	0.00	0.00
bea6fe8e-1526-480c-88e8-289628a11a10	b056757f-95bf-42ea-9c7e-3f75e459b726	eb5d629c-bf85-494a-beaf-6e66885b6bad	2026-04-13	2026-04-19	1341.44	-20.12	1361.24	151.25	0.00	0.00	0.00	1361.24	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	2657194	1361.24	0.00	0.00	0.00
1a782970-f3c7-44d8-85c7-a2eef621c289	b056757f-95bf-42ea-9c7e-3f75e459b726	8666eb6b-dc03-4c2a-a786-43d715b57f40	2026-04-13	2026-04-19	52.77	-0.79	50.57	6.25	0.00	0.00	0.00	50.57	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4150378	50.57	0.00	0.00	0.00
2b39dcbb-aaca-4042-a1bf-4b16239ce191	b056757f-95bf-42ea-9c7e-3f75e459b726	8081d690-38de-4fb9-bd34-cdc176c35865	2026-04-13	2026-04-19	59.73	-0.90	-122.66	-31.41	0.00	0.00	0.00	0.00	debt	\N	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-200.00	\N	0.00	2835207	-122.66	122.66	0.00	122.66
bf536c56-79a7-4d4e-8e17-5ac221a7fbac	b056757f-95bf-42ea-9c7e-3f75e459b726	85e400cf-9b36-4ae3-ade6-13302a38d4ed	2026-04-13	2026-04-19	1880.22	-28.20	1809.51	157.09	0.00	0.00	0.00	1809.51	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-3.51	\N	0.00	4272517	1809.51	0.00	0.00	0.00
5d724da6-e0cc-447c-8c12-b674ba33865a	b056757f-95bf-42ea-9c7e-3f75e459b726	1f72fdc5-fb49-4b52-a23f-c69554dc5b30	2026-04-13	2026-04-19	1493.45	-22.40	1078.46	76.38	0.00	0.00	0.00	1078.46	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-373.43	\N	0.00	4492804	1078.46	0.00	0.00	0.00
29025129-6127-4d08-bec9-34e0db6fd818	b056757f-95bf-42ea-9c7e-3f75e459b726	6c4d01f6-5972-469a-83e5-36d9e49e91cf	2026-04-13	2026-04-19	2485.38	-37.28	2434.45	240.77	0.00	0.00	0.00	2434.45	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	0.00	\N	0.00	4492811	2434.45	0.00	0.00	0.00
f0f3b387-b325-49ed-967a-49610d4ab827	b056757f-95bf-42ea-9c7e-3f75e459b726	3f662a2e-3e89-49f8-beed-fe533d22b00e	2026-04-13	2026-04-19	698.35	-10.48	554.15	43.31	0.00	0.00	0.00	554.15	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-141.71	\N	0.00	2304573	554.15	0.00	0.00	0.00
68b4b04d-2543-4b63-8787-6e98b05dec6b	b056757f-95bf-42ea-9c7e-3f75e459b726	5b18e6ec-238e-484b-808e-c3d5f1b74ac8	2026-04-13	2026-04-19	1462.05	-21.93	1355.68	119.86	0.00	0.00	0.00	1355.68	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-175.31	\N	0.00	2837774	1355.68	0.00	0.00	0.00
6aa689ba-aa57-4871-800a-66f82e13be40	b056757f-95bf-42ea-9c7e-3f75e459b726	9b926250-adf6-41f7-ae0a-1ccda760461f	2026-04-13	2026-04-19	2024.03	-30.36	1894.93	201.09	0.00	0.00	0.00	1894.93	paid	2026-05-01	\N	\N	\N	\N	\N	2026-05-02 00:45:26.974004	-106.46	\N	0.00	2490579	1894.93	0.00	0.00	0.00
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
\.


--
-- TOC entry 3627 (class 0 OID 16721)
-- Dependencies: 215
-- Data for Name: earnings_imports; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_imports (id, organization_id, file_name, import_date, week_start, week_end, platform, total_gross, total_trips, record_count, imported_by, created_at, status, detection_meta) FROM stdin;
2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	b056757f-95bf-42ea-9c7e-3f75e459b726	EYMANOR REPORTS 6-12.xlsx	2026-05-02	2026-04-06	2026-04-12	glovo	31012.05	2419	28	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-05-02 00:35:01.647415	completed	{"rowCount": 29, "headerCount": 11, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 1}
9eaa1920-b706-4bdc-a327-b4cfb20eb09c	b056757f-95bf-42ea-9c7e-3f75e459b726	EYMANOR REPORTS 13-19 April.xlsx	2026-05-02	2026-04-13	2026-04-19	glovo	40162.11	4025	30	7c5c2a84-4fd7-4da3-860f-6c12f9b7990f	2026-05-02 00:43:45.228313	completed	{"rowCount": 31, "headerCount": 11, "filenameDate": null, "detectedPlatform": "glovo", "detectionConfidence": 1}
\.


--
-- TOC entry 3628 (class 0 OID 16739)
-- Dependencies: 216
-- Data for Name: earnings_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.earnings_records (id, import_id, driver_id, platform, trip_date, trip_count, gross_earnings, platform_fee, net_earnings, company_commission, driver_payout, commission_type, created_at, total_transfer_earnings, daily_cash, transfer_commission, cash_commission, account_opening_fee, vehicle_rental_id, vehicle_rental_fee) FROM stdin;
6d33cfe5-6048-4906-aad3-0ae9761d55d5	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	923fc82e-4730-47cb-ba9e-a8af9e9251cb	glovo	2026-04-12	0	797.91	-11.97	764.60	52.99	764.60	percentage	2026-05-02 00:40:44.851985	847.15	-184.74	67.77	-14.78	\N	\N	\N
f8dafbe8-4ade-4b69-8e88-80181ef365d8	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	15cbbadf-c84d-435f-8393-30bdcca08c81	glovo	2026-04-12	97	1368.60	-20.53	1258.01	116.89	1258.01	percentage	2026-05-02 00:40:44.851985	1391.61	-92.86	125.24	-8.36	\N	\N	\N
291bc28c-7135-4d7c-ace9-d97ab08f2a3a	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	0ca3b8ed-0d55-4bff-957e-b453a12105cc	glovo	2026-04-12	0	13.29	-0.20	-83.73	-8.96	-83.73	percentage	2026-05-02 00:40:44.851985	-83.07	-96.16	-4.15	-4.81	\N	\N	\N
a70386e0-a77e-4d9e-951a-5049ac33ec2f	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	4d7d391b-bf01-488f-b001-80cb7057b696	glovo	2026-04-12	0	206.08	-3.09	-94.02	-38.56	-94.02	percentage	2026-05-02 00:40:44.851985	-69.32	-316.28	-6.93	-31.63	\N	\N	\N
ff7fdce5-674e-40b7-9d6b-9d61b36179b1	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	5fee9303-c9e0-4c93-8d0b-e80daf790f69	glovo	2026-04-12	355	2430.96	-36.46	1843.24	117.46	1843.24	percentage	2026-05-02 00:40:44.851985	2054.50	-586.27	164.36	-46.90	\N	\N	\N
4f0df89e-535c-4933-80d9-4bee2a72b995	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	3ab8471a-bafe-432e-acd3-76f09b88f3cf	glovo	2026-04-12	0	599.43	-8.99	492.29	39.14	492.29	percentage	2026-05-02 00:40:44.851985	552.61	-117.67	49.73	-10.59	\N	\N	\N
d803a093-6308-4e7a-b790-d4b62f04faf7	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	glovo	2026-04-12	0	796.93	-11.95	761.22	84.38	761.22	percentage	2026-05-02 00:40:44.851985	846.05	-2.29	84.60	-0.23	\N	\N	\N
3abaff6b-6289-41a9-a9dd-e71c3667e915	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	glovo	2026-04-12	0	620.93	-9.31	241.64	-3.26	241.64	percentage	2026-05-02 00:40:44.851985	291.54	-332.23	23.32	-26.58	\N	\N	\N
480df7c4-18f3-430a-9708-049762d55084	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	89dd665f-5fac-40a3-8df6-667e78d80ac7	glovo	2026-04-12	0	772.63	-11.59	508.37	25.83	508.37	percentage	2026-05-02 00:40:44.851985	574.46	-251.62	45.96	-20.13	\N	\N	\N
41d171f4-f822-4611-bcf6-b508ef03b09a	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	40b8b06a-aeef-445d-8de5-549939e33f17	glovo	2026-04-12	0	867.80	-13.02	753.24	74.71	753.24	percentage	2026-05-02 00:40:44.851985	848.15	-101.02	84.81	-10.10	\N	\N	\N
069b63b9-25fe-4096-b9f4-5384ea6aaa6e	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	277d19f6-4a38-4909-9ddb-d1e83de5e014	glovo	2026-04-12	97	1115.27	-16.73	1129.85	93.90	1129.85	percentage	2026-05-02 00:40:44.851985	1233.27	-59.53	98.66	-4.76	\N	\N	\N
36362721-c73c-48fd-987a-b79d14a2e6dd	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	11086bf8-3977-4f3d-8116-8c006cef839a	glovo	2026-04-12	179	1873.38	-28.10	1927.33	167.59	1927.33	percentage	2026-05-02 00:40:44.851985	2094.92	0.00	167.59	0.00	\N	\N	\N
aba6c4ea-7911-4cc4-a77f-bef323e4145c	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	0b126711-4db1-4eba-9255-0ec8719d2acb	glovo	2026-04-12	101	1453.10	-21.80	1276.38	116.19	1276.38	percentage	2026-05-02 00:40:44.851985	1414.86	-123.82	127.34	-11.14	\N	\N	\N
603287da-c1ac-4979-853d-5cc47d3fb4b5	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	glovo	2026-04-12	0	566.32	-8.49	455.14	37.48	455.14	percentage	2026-05-02 00:40:44.851985	509.34	-92.87	45.84	-8.36	\N	\N	\N
6faa161a-376c-49bf-a1ba-0ef640f2be7c	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	glovo	2026-04-12	685	3388.47	-50.83	3455.73	383.97	3455.73	percentage	2026-05-02 00:40:44.851985	3839.70	0.00	383.97	0.00	\N	\N	\N
c0b113a6-b7ca-4d33-bd48-666c8961d945	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	3e99e189-5c59-4748-af33-132778fe46d9	glovo	2026-04-12	0	543.32	-8.15	579.70	50.41	579.70	percentage	2026-05-02 00:40:44.851985	630.11	0.00	50.41	0.00	\N	\N	\N
fb2c45d3-71bc-4fc2-8094-be009a592651	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	64d26978-b842-4b70-95b9-8cbdcc08e2f5	glovo	2026-04-12	101	1047.68	-15.72	983.32	121.54	983.32	percentage	2026-05-02 00:40:44.851985	1104.86	0.00	121.54	0.00	\N	\N	\N
899818f8-e672-463e-af68-0ff542bdf28c	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	bdbdf261-cc6c-4ccc-8815-cb9787e437dc	glovo	2026-04-12	138	1408.63	-21.13	1417.67	140.21	1417.67	percentage	2026-05-02 00:40:44.851985	1557.88	0.00	140.21	0.00	\N	\N	\N
b96d26f7-aa69-4ed9-a8c9-6e0ca4ba1503	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	23390533-03be-4c9e-a5e3-c84e1ecc268c	glovo	2026-04-12	349	2314.65	-34.72	2419.31	239.27	2419.31	percentage	2026-05-02 00:40:44.851985	2658.58	0.00	239.27	0.00	\N	\N	\N
576078b6-e934-4b27-b52d-116cb6bf2779	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	85e400cf-9b36-4ae3-ade6-13302a38d4ed	glovo	2026-04-12	0	724.24	-10.86	382.76	8.48	382.76	percentage	2026-05-02 00:40:44.851985	445.58	-339.59	35.65	-27.17	\N	\N	\N
b1907d0a-997e-497c-9504-cec6aa8c5a42	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	34ae1ec3-6f90-4898-9418-e9535c691ff2	glovo	2026-04-12	0	691.71	-10.38	716.16	79.57	716.16	percentage	2026-05-02 00:40:44.851985	795.73	0.00	79.57	0.00	\N	\N	\N
9fc48445-697c-48db-90df-8a38f1934913	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	8666eb6b-dc03-4c2a-a786-43d715b57f40	glovo	2026-04-12	0	305.75	-4.59	165.34	9.43	165.34	percentage	2026-05-02 00:40:44.851985	199.88	-114.12	21.99	-12.55	\N	\N	\N
c6298ce3-63f7-4724-9312-5bf5820b1c23	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	3f662a2e-3e89-49f8-beed-fe533d22b00e	glovo	2026-04-12	0	474.61	-7.12	59.41	-24.10	59.41	percentage	2026-05-02 00:40:44.851985	101.83	-369.59	9.16	-33.26	\N	\N	\N
730cee16-e923-4f3c-8f59-9fa36ec3946f	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	5b18e6ec-238e-484b-808e-c3d5f1b74ac8	glovo	2026-04-12	0	1378.64	-20.68	1353.95	129.97	1353.95	percentage	2026-05-02 00:40:44.851985	1492.66	-48.51	134.34	-4.37	\N	\N	\N
db4bb6c9-eb07-4a67-918a-82db0a62278b	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	1f72fdc5-fb49-4b52-a23f-c69554dc5b30	glovo	2026-04-12	138	1476.68	-22.15	1256.05	109.92	1256.05	percentage	2026-05-02 00:40:44.851985	1397.73	-176.40	125.80	-15.88	\N	\N	\N
d42dbe89-f28f-4dbb-91b4-b7117229d05c	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	6c4d01f6-5972-469a-83e5-36d9e49e91cf	glovo	2026-04-12	179	1840.33	-27.60	1755.04	164.29	1755.04	percentage	2026-05-02 00:40:44.851985	1939.93	-114.43	174.59	-10.30	\N	\N	\N
51e06cfb-a39d-441f-96ef-f58dfcb6346b	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	eb5d629c-bf85-494a-beaf-6e66885b6bad	glovo	2026-04-12	0	941.53	-14.12	983.45	109.27	983.45	percentage	2026-05-02 00:40:44.851985	1092.72	0.00	109.27	0.00	\N	\N	\N
6e62281c-5dee-4ac6-a809-613d2b95c62d	2f74a2ce-79f5-4f36-9446-a11ce79fbb3f	8081d690-38de-4fb9-bd34-cdc176c35865	glovo	2026-04-12	0	993.18	-14.90	1019.30	109.11	1019.30	percentage	2026-05-02 00:40:44.851985	1137.73	-46.62	113.77	-4.66	\N	\N	\N
5ae6ff51-4d71-4565-bb5e-fe0c340f7443	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	0ca3b8ed-0d55-4bff-957e-b453a12105cc	glovo	2026-04-19	0	286.21	-4.29	303.05	14.96	303.05	percentage	2026-05-02 00:45:26.974004	320.10	-20.98	16.00	-1.05	\N	\N	\N
5b31f521-3b0c-471e-90d3-acd1e7cbcb36	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	15cbbadf-c84d-435f-8393-30bdcca08c81	glovo	2026-04-19	0	1402.41	-21.04	1356.47	134.16	1356.47	percentage	2026-05-02 00:45:26.974004	1490.63	0.00	134.16	0.00	\N	\N	\N
0ea549b9-860a-477c-a271-6891ba44b9ed	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	124a7a0f-fb31-4a2a-a2d1-e7dbba840603	glovo	2026-04-19	0	901.66	-13.52	693.64	46.18	693.64	percentage	2026-05-02 00:45:26.974004	770.78	-193.48	61.66	-15.48	\N	\N	\N
69d6b58a-404d-488c-9f35-84d9a4b7ef03	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	2aff5bf7-0f5d-4b72-bfd1-c05ff7c511c4	glovo	2026-04-19	238	1660.33	-24.90	1555.81	158.60	1555.81	percentage	2026-05-02 00:45:26.974004	1746.51	-160.52	174.65	-16.05	\N	\N	\N
5de63754-fc38-4ec3-b4e1-966e4eeb1df5	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	923fc82e-4730-47cb-ba9e-a8af9e9251cb	glovo	2026-04-19	0	941.68	-14.13	1049.03	91.22	1049.03	percentage	2026-05-02 00:45:26.974004	1140.25	0.00	91.22	0.00	\N	\N	\N
054ad96b-0e3d-4b63-9554-55ebbbbd87c8	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	5fee9303-c9e0-4c93-8d0b-e80daf790f69	glovo	2026-04-19	853	3373.14	-50.60	2975.16	222.52	2975.16	percentage	2026-05-02 00:45:26.974004	3276.95	-495.43	262.16	-39.63	\N	\N	\N
132b0ad2-8a25-4446-8115-673620f7ab8a	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	4d7d391b-bf01-488f-b001-80cb7057b696	glovo	2026-04-19	0	268.58	-4.03	299.84	33.32	299.84	percentage	2026-05-02 00:45:26.974004	333.16	0.00	33.32	0.00	\N	\N	\N
a5bbc4a9-d69b-4732-96bc-d1cde7d35556	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	89dd665f-5fac-40a3-8df6-667e78d80ac7	glovo	2026-04-19	0	1017.32	-15.26	1048.63	91.19	1048.63	percentage	2026-05-02 00:45:26.974004	1139.82	0.00	91.19	0.00	\N	\N	\N
9e97d4ca-9f8d-4160-8c5a-c3e2c7e81505	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	40b8b06a-aeef-445d-8de5-549939e33f17	glovo	2026-04-19	0	606.86	-9.10	664.76	73.86	664.76	percentage	2026-05-02 00:45:26.974004	738.62	0.00	73.86	0.00	\N	\N	\N
d46535e8-b971-490b-9740-3b62cdeb7fd2	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	277d19f6-4a38-4909-9ddb-d1e83de5e014	glovo	2026-04-19	0	438.87	-6.58	71.36	-20.39	71.36	percentage	2026-05-02 00:45:26.974004	109.22	-364.06	8.74	-29.12	\N	\N	\N
6b06a1dc-8a74-4b46-827d-0556f43bbc35	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	11086bf8-3977-4f3d-8116-8c006cef839a	glovo	2026-04-19	218	2195.60	-32.93	2305.83	200.51	2305.83	percentage	2026-05-02 00:45:26.974004	2506.34	0.00	200.51	0.00	\N	\N	\N
61b0e5fe-a121-4f8a-a11f-c87661b83ff3	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	0b126711-4db1-4eba-9255-0ec8719d2acb	glovo	2026-04-19	145	1818.15	-27.27	1755.73	173.64	1755.73	percentage	2026-05-02 00:45:26.974004	1929.37	0.00	173.64	0.00	\N	\N	\N
7f0ea3f7-985f-4a6d-9f16-1c33ec0cf7fc	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	dfd4e435-f1b0-4607-a6b1-b1001d9a6cbb	glovo	2026-04-19	0	1301.47	-19.52	1059.74	89.56	1059.74	percentage	2026-05-02 00:45:26.974004	1183.15	-188.07	106.48	-16.93	\N	\N	\N
206dacf0-4811-4304-8da5-36d70d17fd70	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	ae3fc6c2-5915-4f02-bd21-2c62c26d6092	glovo	2026-04-19	1019	3722.94	-55.84	3536.75	385.27	3536.75	percentage	2026-05-02 00:45:26.974004	3939.35	-86.68	393.93	-8.67	\N	\N	\N
ddb37553-d0ad-4623-bf33-383559fce80e	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	3e99e189-5c59-4748-af33-132778fe46d9	glovo	2026-04-19	0	759.57	-11.39	585.48	33.58	585.48	percentage	2026-05-02 00:45:26.974004	657.02	-237.24	52.56	-18.98	\N	\N	\N
4bde0aba-734a-498a-b64f-3c4a894ace2e	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	c2bdb349-2e52-4adb-9044-b6c683c2ab13	glovo	2026-04-19	0	549.08	-8.24	469.38	51.26	469.38	percentage	2026-05-02 00:45:26.974004	536.04	-70.01	58.96	-7.70	\N	\N	\N
c80c7f0a-8461-4408-af4f-ff75bda3924b	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	64d26978-b842-4b70-95b9-8cbdcc08e2f5	glovo	2026-04-19	145	1603.89	-24.06	1628.58	201.28	1628.58	percentage	2026-05-02 00:45:26.974004	1829.86	0.00	201.28	0.00	\N	\N	\N
58247a3d-f4ac-4524-aa82-a0bf0367a335	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	9b926250-adf6-41f7-ae0a-1ccda760461f	glovo	2026-04-19	238	2024.03	-30.36	1894.93	201.09	1894.93	percentage	2026-05-02 00:45:26.974004	2117.31	-106.46	211.73	-10.65	\N	\N	\N
afca30b1-7335-4271-955d-db2e74534d13	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	85e400cf-9b36-4ae3-ade6-13302a38d4ed	glovo	2026-04-19	175	1880.22	-28.20	1809.51	157.09	1809.51	percentage	2026-05-02 00:45:26.974004	1967.16	-3.51	157.37	-0.28	\N	\N	\N
5c2cc670-cbfd-4494-aefd-7213c43ed594	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	34ae1ec3-6f90-4898-9418-e9535c691ff2	glovo	2026-04-19	0	529.74	-7.95	336.14	19.98	336.14	percentage	2026-05-02 00:45:26.974004	395.19	-195.34	39.52	-19.53	\N	\N	\N
c8d285e4-e003-483e-bb7a-0fc37509c8fa	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	bdbdf261-cc6c-4ccc-8815-cb9787e437dc	glovo	2026-04-19	175	1977.77	-29.67	2012.67	199.06	2012.67	percentage	2026-05-02 00:45:26.974004	2211.73	0.00	199.06	0.00	\N	\N	\N
ca0d166f-998a-4d5d-8dfc-f5161cd12b18	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	23390533-03be-4c9e-a5e3-c84e1ecc268c	glovo	2026-04-19	145	1141.28	-17.12	1137.47	112.50	1137.47	percentage	2026-05-02 00:45:26.974004	1249.97	0.00	112.50	0.00	\N	\N	\N
36620ba7-a096-44d8-8f7d-c0df2b8406fb	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	8666eb6b-dc03-4c2a-a786-43d715b57f40	glovo	2026-04-19	0	52.77	-0.79	50.57	6.25	50.57	percentage	2026-05-02 00:45:26.974004	56.82	0.00	6.25	0.00	\N	\N	\N
8d59dd1a-07d7-4632-96e8-81d8916cb4c8	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	5b18e6ec-238e-484b-808e-c3d5f1b74ac8	glovo	2026-04-19	0	1462.05	-21.93	1355.68	119.86	1355.68	percentage	2026-05-02 00:45:26.974004	1507.10	-175.31	135.64	-15.78	\N	\N	\N
d46cf024-faaf-42ee-b2d5-fbc76e86fc7b	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	6c4d01f6-5972-469a-83e5-36d9e49e91cf	glovo	2026-04-19	407	2485.38	-37.28	2434.45	240.77	2434.45	percentage	2026-05-02 00:45:26.974004	2675.22	0.00	240.77	0.00	\N	\N	\N
78e48610-3933-4eaf-8239-6dbab1a74d23	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	3f662a2e-3e89-49f8-beed-fe533d22b00e	glovo	2026-04-19	0	698.35	-10.48	554.15	43.31	554.15	percentage	2026-05-02 00:45:26.974004	622.97	-141.71	56.07	-12.75	\N	\N	\N
a827743f-4ba7-4ce4-bd19-1eeacbd18c0f	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	1f72fdc5-fb49-4b52-a23f-c69554dc5b30	glovo	2026-04-19	0	1493.45	-22.40	1078.46	76.38	1078.46	percentage	2026-05-02 00:45:26.974004	1222.05	-373.43	109.98	-33.61	\N	\N	\N
dc676225-a065-4fe1-8fbd-2ea118c42dab	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	fedc175f-938e-4022-a4d8-463633357218	glovo	2026-04-19	267	2168.14	-32.52	2228.21	220.37	2228.21	percentage	2026-05-02 00:45:26.974004	2448.58	0.00	220.37	0.00	\N	\N	\N
aae2d32f-332d-4b1d-8a29-455b5ee99022	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	eb5d629c-bf85-494a-beaf-6e66885b6bad	glovo	2026-04-19	0	1341.44	-20.12	1361.24	151.25	1361.24	percentage	2026-05-02 00:45:26.974004	1512.49	0.00	151.25	0.00	\N	\N	\N
49901c32-e910-47ba-9f3e-31fe6721302f	9eaa1920-b706-4bdc-a327-b4cfb20eb09c	8081d690-38de-4fb9-bd34-cdc176c35865	glovo	2026-04-19	0	59.73	-0.90	-122.66	-31.41	-122.66	percentage	2026-05-02 00:45:26.974004	-114.07	-200.00	-11.41	-20.00	\N	\N	\N
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


-- Completed on 2026-05-02 08:11:01

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

-- Started on 2026-05-02 08:11:01

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


-- Completed on 2026-05-02 08:11:05

--
-- PostgreSQL database dump complete
--

-- Completed on 2026-05-02 08:11:05

--
-- PostgreSQL database cluster dump complete
--

