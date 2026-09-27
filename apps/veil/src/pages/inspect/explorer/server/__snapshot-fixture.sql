-- Fixture for __snapshot-fixture.test.ts: a synthetic pindexer schema that
-- exercises fetchValidatorChainSnapshots (see that file for how to load it).
-- Blocks: 40 days of 6h steps ending exactly on the current hour.
DROP TABLE IF EXISTS block_details, supply_total_staked, stake_validator_set;

CREATE TABLE block_details(
  height BIGINT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL
);
CREATE TABLE supply_total_staked(
  validator_id BYTEA NOT NULL,
  height BIGINT NOT NULL,
  um BIGINT NOT NULL,
  rate_bps2 BIGINT NOT NULL
);
CREATE TABLE stake_validator_set(
  id BYTEA PRIMARY KEY,
  ik TEXT NOT NULL,
  name TEXT,
  validator_state TEXT
);

INSERT INTO block_details(height, timestamp)
SELECT 1 + g * 6, date_trunc('hour', now()) - interval '40 days' + (g * 6) * interval '1 hour'
FROM generate_series(0, 160) g;

INSERT INTO stake_validator_set(id, ik, name, validator_state) VALUES
  ('\x01', 'penumbravalid1active',  'Active',  '{"state":"VALIDATOR_STATE_ENUM_ACTIVE"}'),
  ('\x02', 'penumbravalid1jailed',  'Jailed',  '{"state":"VALIDATOR_STATE_ENUM_JAILED"}'),
  ('\x03', 'penumbravalid1defined', 'Defined', '{"state":"VALIDATOR_STATE_ENUM_DEFINED"}'),
  ('\x04', 'penumbravalid1drained', 'Drained', '{"state":"ACTIVE"}'),
  ('\x05', 'penumbravalid1norows',  'NoRows',  '{"state":"VALIDATOR_STATE_ENUM_TOMBSTONED"}'),
  ('\x06', 'penumbravalid1slashed', 'Slashed', '{"state":"VALIDATOR_STATE_ENUM_ACTIVE"}');

-- \x01: pays 12.1665%/yr from the window start; 3.11M UM bonded.
INSERT INTO supply_total_staked(validator_id, height, um, rate_bps2)
SELECT '\x01', bd.height, 3110000000000,
  CASE
    WHEN bd.timestamp <= date_trunc('hour', now()) - interval '30 days' THEN 100000000
    ELSE 100000000 + round(
      100000000 * 0.121665
      * EXTRACT(epoch FROM bd.timestamp - (date_trunc('hour', now()) - interval '30 days'))
      / 86400 / 365)
  END
FROM block_details bd;

-- \x02: jailed, so its exchange rate is frozen at the window start value.
INSERT INTO supply_total_staked(validator_id, height, um, rate_bps2)
SELECT '\x02', bd.height, 15000000000000, 100000000 FROM block_details bd;

-- \x03: only indexed for the last 10 days: no rate at the window start.
INSERT INTO supply_total_staked(validator_id, height, um, rate_bps2)
SELECT '\x03', bd.height, 50000000000, 100000000
FROM block_details bd
WHERE bd.timestamp > date_trunc('hour', now()) - interval '10 days';

-- \x04: had stake, then all delegations left: latest rate is 0.
INSERT INTO supply_total_staked(validator_id, height, um, rate_bps2)
SELECT '\x04', bd.height, 0,
  CASE WHEN bd.timestamp <= date_trunc('hour', now()) - interval '30 days' THEN 100000000 ELSE 0 END
FROM block_details bd;

-- \x06: slashed 1% inside the window.
INSERT INTO supply_total_staked(validator_id, height, um, rate_bps2)
SELECT '\x06', bd.height, 1000000000000,
  CASE WHEN bd.timestamp <= date_trunc('hour', now()) - interval '30 days' THEN 100000000 ELSE 99000000 END
FROM block_details bd;
