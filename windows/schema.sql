--
-- PostgreSQL database dump
--

\restrict dosF1Al1MCTzm0fNJhGufcMVyPXDHeRdzhzRxW6Pg3sDVZQoFLxrQiJU7EyV0pL

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg12+1)

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
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_config; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.agent_config (
    id integer NOT NULL,
    key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    description character varying(500),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.agent_config OWNER TO interviewlab;

--
-- Name: agent_config_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.agent_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agent_config_id_seq OWNER TO interviewlab;

--
-- Name: agent_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.agent_config_id_seq OWNED BY public.agent_config.id;


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


ALTER TABLE public.alembic_version OWNER TO interviewlab;

--
-- Name: app_secrets; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.app_secrets (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    value_encrypted text NOT NULL,
    masked_preview character varying(100) DEFAULT ''::character varying NOT NULL,
    updated_by character varying(255),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.app_secrets OWNER TO interviewlab;

--
-- Name: app_secrets_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.app_secrets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.app_secrets_id_seq OWNER TO interviewlab;

--
-- Name: app_secrets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.app_secrets_id_seq OWNED BY public.app_secrets.id;


--
-- Name: code_topics; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.code_topics (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    category character varying(100) NOT NULL,
    difficulty character varying(30) NOT NULL,
    languages character varying(100) NOT NULL,
    problem_statement text NOT NULL,
    discussion_hints text,
    review_rubric text,
    reference_solution text,
    source character varying(500),
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.code_topics OWNER TO interviewlab;

--
-- Name: code_topics_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.code_topics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.code_topics_id_seq OWNER TO interviewlab;

--
-- Name: code_topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.code_topics_id_seq OWNED BY public.code_topics.id;


--
-- Name: english_topics; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.english_topics (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    skill_focus character varying(50) NOT NULL,
    level character varying(30) NOT NULL,
    scenario_prompt text NOT NULL,
    key_vocabulary text,
    evaluation_criteria text,
    source character varying(500),
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scenes jsonb,
    target_language character varying(50) DEFAULT 'English'::character varying NOT NULL
);


ALTER TABLE public.english_topics OWNER TO interviewlab;

--
-- Name: english_topics_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.english_topics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.english_topics_id_seq OWNER TO interviewlab;

--
-- Name: english_topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.english_topics_id_seq OWNED BY public.english_topics.id;


--
-- Name: interviews; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.interviews (
    id integer NOT NULL,
    user_id integer NOT NULL,
    resume_id integer,
    title character varying(255) NOT NULL,
    status character varying(50) NOT NULL,
    conversation_history json,
    resume_context json,
    job_description text,
    feedback json,
    turn_count integer NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_mode character varying(30) DEFAULT 'interview'::character varying NOT NULL,
    llm_calls integer DEFAULT 0 NOT NULL,
    llm_prompt_tokens integer DEFAULT 0 NOT NULL,
    llm_cached_tokens integer DEFAULT 0 NOT NULL,
    llm_completion_tokens integer DEFAULT 0 NOT NULL,
    llm_cost_usd numeric(12,6) DEFAULT '0'::numeric NOT NULL,
    CONSTRAINT ck_interviews_session_mode CHECK (((session_mode)::text = ANY ((ARRAY['interview'::character varying, 'code_practice'::character varying, 'language_practice'::character varying])::text[])))
);


ALTER TABLE public.interviews OWNER TO interviewlab;

--
-- Name: interviews_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.interviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.interviews_id_seq OWNER TO interviewlab;

--
-- Name: interviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.interviews_id_seq OWNED BY public.interviews.id;


--
-- Name: question_bank; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.question_bank (
    id integer NOT NULL,
    category character varying(100) NOT NULL,
    subcategory character varying(100),
    level character varying(20) NOT NULL,
    topic character varying(200) NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    source character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    embedding public.vector(1536)
);


ALTER TABLE public.question_bank OWNER TO interviewlab;

--
-- Name: question_bank_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.question_bank_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.question_bank_id_seq OWNER TO interviewlab;

--
-- Name: question_bank_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.question_bank_id_seq OWNED BY public.question_bank.id;


--
-- Name: resumes; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.resumes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(512) NOT NULL,
    file_size integer NOT NULL,
    file_type character varying(50) NOT NULL,
    extracted_data json,
    analysis_status character varying(50) NOT NULL,
    analysis_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.resumes OWNER TO interviewlab;

--
-- Name: resumes_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.resumes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.resumes_id_seq OWNER TO interviewlab;

--
-- Name: resumes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.resumes_id_seq OWNED BY public.resumes.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: interviewlab
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    hashed_password character varying(255) NOT NULL,
    full_name character varying(255),
    is_active boolean NOT NULL,
    is_verified boolean NOT NULL,
    is_admin boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO interviewlab;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: interviewlab
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO interviewlab;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: interviewlab
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: agent_config id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.agent_config ALTER COLUMN id SET DEFAULT nextval('public.agent_config_id_seq'::regclass);


--
-- Name: app_secrets id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.app_secrets ALTER COLUMN id SET DEFAULT nextval('public.app_secrets_id_seq'::regclass);


--
-- Name: code_topics id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.code_topics ALTER COLUMN id SET DEFAULT nextval('public.code_topics_id_seq'::regclass);


--
-- Name: english_topics id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.english_topics ALTER COLUMN id SET DEFAULT nextval('public.english_topics_id_seq'::regclass);


--
-- Name: interviews id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.interviews ALTER COLUMN id SET DEFAULT nextval('public.interviews_id_seq'::regclass);


--
-- Name: question_bank id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.question_bank ALTER COLUMN id SET DEFAULT nextval('public.question_bank_id_seq'::regclass);


--
-- Name: resumes id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.resumes ALTER COLUMN id SET DEFAULT nextval('public.resumes_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: agent_config agent_config_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.agent_config
    ADD CONSTRAINT agent_config_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: app_secrets app_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.app_secrets
    ADD CONSTRAINT app_secrets_pkey PRIMARY KEY (id);


--
-- Name: code_topics code_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.code_topics
    ADD CONSTRAINT code_topics_pkey PRIMARY KEY (id);


--
-- Name: english_topics english_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.english_topics
    ADD CONSTRAINT english_topics_pkey PRIMARY KEY (id);


--
-- Name: interviews interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_pkey PRIMARY KEY (id);


--
-- Name: question_bank question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_pkey PRIMARY KEY (id);


--
-- Name: resumes resumes_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.resumes
    ADD CONSTRAINT resumes_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_agent_config_key; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE UNIQUE INDEX ix_agent_config_key ON public.agent_config USING btree (key);


--
-- Name: ix_app_secrets_name; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE UNIQUE INDEX ix_app_secrets_name ON public.app_secrets USING btree (name);


--
-- Name: ix_code_topics_category; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_code_topics_category ON public.code_topics USING btree (category);


--
-- Name: ix_code_topics_difficulty; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_code_topics_difficulty ON public.code_topics USING btree (difficulty);


--
-- Name: ix_english_topics_level; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_english_topics_level ON public.english_topics USING btree (level);


--
-- Name: ix_english_topics_skill_focus; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_english_topics_skill_focus ON public.english_topics USING btree (skill_focus);


--
-- Name: ix_english_topics_target_language; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_english_topics_target_language ON public.english_topics USING btree (target_language);


--
-- Name: ix_interviews_id; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_interviews_id ON public.interviews USING btree (id);


--
-- Name: ix_interviews_resume_id; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_interviews_resume_id ON public.interviews USING btree (resume_id);


--
-- Name: ix_interviews_session_mode; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_interviews_session_mode ON public.interviews USING btree (session_mode);


--
-- Name: ix_interviews_user_id; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_interviews_user_id ON public.interviews USING btree (user_id);


--
-- Name: ix_question_bank_category; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_question_bank_category ON public.question_bank USING btree (category);


--
-- Name: ix_question_bank_level; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_question_bank_level ON public.question_bank USING btree (level);


--
-- Name: ix_question_bank_subcategory; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_question_bank_subcategory ON public.question_bank USING btree (subcategory);


--
-- Name: ix_resumes_id; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_resumes_id ON public.resumes USING btree (id);


--
-- Name: ix_resumes_user_id; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_resumes_user_id ON public.resumes USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_id; Type: INDEX; Schema: public; Owner: interviewlab
--

CREATE INDEX ix_users_id ON public.users USING btree (id);


--
-- Name: interviews interviews_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id);


--
-- Name: interviews interviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: resumes resumes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: interviewlab
--

ALTER TABLE ONLY public.resumes
    ADD CONSTRAINT resumes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dosF1Al1MCTzm0fNJhGufcMVyPXDHeRdzhzRxW6Pg3sDVZQoFLxrQiJU7EyV0pL

--
-- PostgreSQL database dump
--

\restrict w0tELaSWA8OfVxOaBRENjsAGHGzuXgR00sex3vQgtVV5FEidwUYbwxsEiJCGJ9u

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg12+1)

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
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: interviewlab
--

COPY public.alembic_version (version_num) FROM stdin;
add_interview_usage_001
\.


--
-- PostgreSQL database dump complete
--

\unrestrict w0tELaSWA8OfVxOaBRENjsAGHGzuXgR00sex3vQgtVV5FEidwUYbwxsEiJCGJ9u

