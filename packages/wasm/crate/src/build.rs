use crate::error::WasmResult;
use crate::utils;
use penumbra_keys::FullViewingKey;
use penumbra_proto::DomainType;
use penumbra_transaction::{
    plan::{ActionPlan, TransactionPlan},
    Action, AuthorizationData, Transaction, WitnessData,
};
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

#[cfg(feature = "parallel")]
use rayon::prelude::*;

/// Builds a planned [`Action`] specified by
/// the [`ActionPlan`] in a [`TransactionPlan`].
/// Arguments:
///     transaction_plan: `TransactionPlan`
///     action_plan: `ActionPlan`
///     full_viewing_key: `FullViewingKey`
///     witness_data: `WitnessData``
/// Returns: `Action`
#[wasm_bindgen]
pub fn build_action(
    transaction_plan: &[u8],
    action_plan: &[u8],
    full_viewing_key: &[u8],
    witness_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();
    let transaction_plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let action_plan = ActionPlan::decode(action_plan)?;
    let full_viewing_key = FullViewingKey::decode(full_viewing_key)?;

    let action = build_action_inner(transaction_plan, action_plan, full_viewing_key, witness)?;

    Ok(action.encode_to_vec())
}

pub fn build_action_inner(
    transaction_plan: TransactionPlan,
    action_plan: ActionPlan,
    full_viewing_key: FullViewingKey,
    witness: WitnessData,
) -> WasmResult<Action> {
    let memo_key = transaction_plan.memo.map(|memo_plan| memo_plan.key);

    let action = ActionPlan::build_unauth(action_plan, &full_viewing_key, &witness, memo_key)?;

    Ok(action)
}

/// Build serial tx –
/// building a transaction may take some time,
/// depending on CPU performance and number of actions
/// in the transaction plan.
/// Arguments:
///     full_viewing_key: `FullViewingKey`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
///     auth_data: `AuthorizationData`
/// Returns: `Transaction`
#[wasm_bindgen]
pub fn build_serial(
    full_viewing_key: &[u8],
    transaction_plan: &[u8],
    witness_data: &[u8],
    auth_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let auth = AuthorizationData::decode(auth_data)?;
    let fvk = FullViewingKey::decode(full_viewing_key)?;

    let tx: Transaction = build_serial_inner(fvk, plan, witness, auth)?;

    Ok(tx.encode_to_vec())
}

pub fn build_serial_inner(
    fvk: FullViewingKey,
    plan: TransactionPlan,
    witness: WitnessData,
    auth: AuthorizationData,
) -> WasmResult<Transaction> {
    let tx: Transaction = plan.build(&fvk, &witness, &auth)?;

    Ok(tx)
}

/// Build parallel tx –
/// building a transaction may take some time,
/// depending on CPU performance and number of
/// actions in the transaction plan.
/// Arguments:
///     actions: `Vec<Actions>`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
///     auth_data: `AuthorizationData`
/// Returns: `Transaction`
#[wasm_bindgen]
pub fn build_parallel(
    actions: JsValue,
    transaction_plan: &[u8],
    witness_data: &[u8],
    auth_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let auth = AuthorizationData::decode(auth_data)?;
    let actions: Vec<Action> = serde_wasm_bindgen::from_value(actions)?;

    let tx = build_parallel_inner(actions, plan, witness, auth)?;

    Ok(tx.encode_to_vec())
}

pub fn build_parallel_inner(
    actions: Vec<Action>,
    plan: TransactionPlan,
    witness: WitnessData,
    auth: AuthorizationData,
) -> WasmResult<Transaction> {
    let transaction = plan.clone().build_unauth_with_actions(actions, &witness)?;
    let tx = plan.apply_auth_data(&auth, transaction)?;

    Ok(tx)
}

/// Build (prove) every action of a transaction plan concurrently with rayon,
/// WITHOUT authorization data.
///
/// This is the expensive part of transaction building (one ZK proof per
/// action) and needs only the full viewing key and witness, so callers can
/// start it as soon as the plan is ready -- e.g. while the user is still
/// looking at the approval prompt. The result carries no spend authorization;
/// it must be assembled with [`build_parallel`] (which applies the
/// `AuthorizationData`) before it is a valid transaction.
///
/// Requires the `parallel` feature and `initThreadPool()` to be called first.
///
/// Arguments:
///     full_viewing_key: `FullViewingKey`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
/// Returns: `TransactionBody` bytes whose `actions` field holds the built
///     actions in plan order (all other fields are unset). A proto container
///     is used so the result survives the JSON hops between worker, offscreen
///     document and service worker without serde/JsValue representation issues.
#[cfg(feature = "parallel")]
#[wasm_bindgen]
pub fn build_actions_native(
    full_viewing_key: &[u8],
    transaction_plan: &[u8],
    witness_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let fvk = FullViewingKey::decode(full_viewing_key)?;

    let actions = build_actions_native_inner(&plan, &witness, &fvk)?;

    let body = penumbra_proto::core::transaction::v1::TransactionBody {
        actions: actions.into_iter().map(Into::into).collect(),
        ..Default::default()
    };

    Ok(prost::Message::encode_to_vec(&body))
}

#[cfg(feature = "parallel")]
pub fn build_actions_native_inner(
    plan: &TransactionPlan,
    witness: &WitnessData,
    fvk: &FullViewingKey,
) -> WasmResult<Vec<Action>> {
    let memo_key = plan.memo.as_ref().map(|memo_plan| memo_plan.key);

    // Build all actions in parallel using rayon; collect preserves plan order.
    let actions = plan
        .actions
        .par_iter()
        .map(|action_plan| ActionPlan::build_unauth(action_plan.clone(), fvk, witness, memo_key))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(actions)
}

/// Build transaction with rayon parallel action building.
/// Requires the `parallel` feature and `initThreadPool()` to be called first.
///
/// This builds all actions concurrently using rayon's par_iter(), which is
/// significantly faster for transactions with multiple actions (e.g., swaps,
/// multi-output sends) because ZK proof generation happens in parallel.
///
/// Prefer [`build_actions_native`] + [`build_parallel`] when authorization
/// arrives later than the plan (it lets proving overlap user approval).
///
/// Arguments:
///     full_viewing_key: `FullViewingKey`
///     transaction_plan: `TransactionPlan`
///     witness_data: `WitnessData`
///     auth_data: `AuthorizationData`
/// Returns: `Transaction`
#[cfg(feature = "parallel")]
#[wasm_bindgen]
pub fn build_parallel_native(
    full_viewing_key: &[u8],
    transaction_plan: &[u8],
    witness_data: &[u8],
    auth_data: &[u8],
) -> WasmResult<Vec<u8>> {
    utils::set_panic_hook();

    let plan = TransactionPlan::decode(transaction_plan)?;
    let witness = WitnessData::decode(witness_data)?;
    let auth = AuthorizationData::decode(auth_data)?;
    let fvk = FullViewingKey::decode(full_viewing_key)?;

    let actions = build_actions_native_inner(&plan, &witness, &fvk)?;

    // Assemble the final transaction
    let tx = build_parallel_inner(actions, plan, witness, auth)?;

    Ok(tx.encode_to_vec())
}
