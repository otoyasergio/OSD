CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_user (
    user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid UNIQUE,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text UNIQUE NOT NULL,
    phone text,
    role text NOT NULL CHECK (role IN ('owner', 'manager', 'service_advisor', 'technician', 'admin')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

CREATE TABLE customer (
    customer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name text NOT NULL,
    last_name text NOT NULL,
    phone text,
    email text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE motorcycle (
    motorcycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customer(customer_id) ON DELETE RESTRICT,
    year integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    vin text,
    colour text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE motorcycle_service_information (
    service_information_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    motorcycle_id uuid NOT NULL UNIQUE REFERENCES motorcycle(motorcycle_id) ON DELETE CASCADE,
    oil_filter text,
    oil_type text,
    oil_capacity text,
    air_filter text,
    spark_plugs text,
    front_brake_pads text,
    rear_brake_pads text,
    front_tire_size text,
    rear_tire_size text,
    chain text,
    battery text,
    notes text,
    last_updated timestamptz NOT NULL DEFAULT now(),
    last_updated_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL
);

CREATE TABLE service (
    service_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    standard_price numeric(10, 2),
    estimated_labour numeric(6, 2),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order (
    work_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    motorcycle_id uuid NOT NULL REFERENCES motorcycle(motorcycle_id) ON DELETE RESTRICT,
    external_invoice_number text,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',
        'open',
        'inspection_in_progress',
        'waiting_for_customer_approval',
        'waiting_for_parts',
        'ready_for_technician',
        'in_progress',
        'quality_check',
        'ready_for_pickup',
        'completed',
        'cancelled',
        'on_hold'
    )),
    primary_technician_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    date_created timestamptz NOT NULL DEFAULT now(),
    estimated_completion timestamptz,
    mileage integer,
    internal_notes text,
    quality_checked_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    quality_checked_at timestamptz,
    quality_check_notes text,
    ready_for_pickup_at timestamptz,
    completed_at timestamptz,
    released_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    pickup_notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order_technician (
    work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    technician_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
    assigned_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_order_id, technician_id)
);

CREATE TABLE job (
    job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES service(service_id) ON DELETE RESTRICT,
    service_name_snapshot text NOT NULL,
    standard_price_snapshot numeric(10, 2),
    estimated_labour_snapshot numeric(6, 2),
    assigned_technician_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',
        'waiting_for_approval',
        'approved',
        'declined',
        'waiting_for_parts',
        'ready_to_start',
        'in_progress',
        'completed',
        'cancelled'
    )),
    notes text,
    approved_by_customer_at timestamptz,
    approval_method text CHECK (approval_method IS NULL OR approval_method IN (
        'phone',
        'email',
        'text',
        'in_person',
        'written_estimate',
        'other'
    )),
    approval_recorded_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    declined_at timestamptz,
    decline_reason text,
    created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection (
    inspection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL UNIQUE REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    started_at timestamptz,
    completed_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection_template_item (
    template_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category text NOT NULL,
    item_name text NOT NULL,
    display_order integer NOT NULL,
    requires_measurement boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inspection_result (
    inspection_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id uuid NOT NULL REFERENCES inspection(inspection_id) ON DELETE CASCADE,
    template_item_id uuid NOT NULL REFERENCES inspection_template_item(template_item_id) ON DELETE RESTRICT,
    category_snapshot text NOT NULL,
    item_name_snapshot text NOT NULL,
    display_order_snapshot integer NOT NULL,
    requires_measurement_snapshot boolean NOT NULL DEFAULT false,
    status text CHECK (status IS NULL OR status IN ('ok', 'future_attention', 'immediate_attention')),
    measurement text,
    notes text,
    updated_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (inspection_id, template_item_id)
);

CREATE TABLE recommendation (
    recommendation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    inspection_result_id uuid REFERENCES inspection_result(inspection_result_id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    description text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('future_attention', 'immediate_attention', 'safety_critical')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'approved',
        'declined',
        'converted_to_job',
        'deferred'
    )),
    converted_job_id uuid REFERENCES job(job_id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE TABLE part (
    part_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES job(job_id) ON DELETE CASCADE,
    part_name text NOT NULL,
    part_number text,
    supplier text,
    quantity numeric(10, 2) NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'needed' CHECK (status IN (
        'needed',
        'in_stock',
        'ordered',
        'installed',
        'not_required',
        'cancelled'
    )),
    notes text,
    created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    ordered_at timestamptz,
    installed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intake_photo (
    photo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    uploaded_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    storage_path text NOT NULL,
    photo_url text,
    category text NOT NULL CHECK (category IN (
        'front',
        'rear',
        'left_side',
        'right_side',
        'odometer',
        'vin',
        'damage',
        'accessories',
        'fuel_level',
        'other'
    )),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE technician_note (
    technician_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    job_id uuid REFERENCES job(job_id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    note text NOT NULL,
    note_type text NOT NULL DEFAULT 'general' CHECK (note_type IN (
        'general',
        'diagnostic_finding',
        'customer_concern_confirmed',
        'customer_concern_not_found',
        'parts_issue',
        'road_test',
        'quality_check',
        'internal_warning'
    )),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE timeline_event (
    timeline_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES work_order(work_order_id) ON DELETE CASCADE,
    user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    description text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_motorcycle_customer_id ON motorcycle(customer_id);
CREATE INDEX idx_work_order_motorcycle_id ON work_order(motorcycle_id);
CREATE INDEX idx_work_order_status ON work_order(status);
CREATE INDEX idx_work_order_primary_technician_id ON work_order(primary_technician_id);
CREATE INDEX idx_job_work_order_id ON job(work_order_id);
CREATE INDEX idx_job_status ON job(status);
CREATE INDEX idx_job_assigned_technician_id ON job(assigned_technician_id);
CREATE INDEX idx_part_job_id ON part(job_id);
CREATE INDEX idx_part_status ON part(status);
CREATE INDEX idx_recommendation_work_order_id ON recommendation(work_order_id);
CREATE INDEX idx_recommendation_status ON recommendation(status);
CREATE INDEX idx_inspection_result_inspection_id ON inspection_result(inspection_id);
CREATE INDEX idx_timeline_event_work_order_id ON timeline_event(work_order_id);
CREATE INDEX idx_timeline_event_created_at ON timeline_event(created_at);
