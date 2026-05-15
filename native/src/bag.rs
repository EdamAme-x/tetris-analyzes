use napi::bindgen_prelude::{Error, Result};
use napi_derive::napi;

use crate::board::BoardRows;
use crate::firepower::firepower_score;
use crate::pieces::{parse_queue, piece_name, Piece};
use crate::spin::SpinMode;
use crate::tetrio_tables::{ComboTable, KickTable};
use crate::{
    search_opener_states, validate_beam_width, FastHashMap, FastHashSet, SearchState,
    DEFAULT_SETUP_CANDIDATE_POOL_MULTIPLIER,
};

const BAG_SAMPLE_MULTIPLIER: usize = 197;

#[derive(Clone)]
#[napi(object)]
pub struct OpenerQueueEvaluation {
    pub queue: String,
    pub buildable: bool,
    pub pareto_front: bool,
    pub dominated_by: u32,
    pub weighted_score: f64,
    pub top_score: f64,
    pub firepower_score: f64,
    pub attack: u32,
    pub difficult_attack: u32,
    pub points: u32,
    pub all_clears: u32,
    pub difficult_clears: u32,
    pub spin_clears: u32,
    pub spin_attack: u32,
    pub t_spin_clears: u32,
    pub t_spin_attack: u32,
    pub back_to_back_chain: u32,
    pub t_spin_potential: u32,
    pub depth: u32,
    pub holes: u32,
    pub bumpiness: u32,
}

#[napi(object)]
pub struct OpenerBagEvaluation {
    pub bag: String,
    pub total_queues: u32,
    pub searched_queues: u32,
    pub exact: bool,
    pub buildable_queues: u32,
    pub build_rate: f64,
    pub average_score: f64,
    pub average_attack: f64,
    pub average_firepower_score: f64,
    pub average_holes: f64,
    pub average_bumpiness: f64,
    pub worst_score: f64,
    pub best_score: f64,
    pub pareto_front: Vec<OpenerQueueEvaluation>,
    pub top_queues: Vec<OpenerQueueEvaluation>,
}

#[derive(Clone)]
#[napi(object)]
pub struct OpenerBagTemplate {
    pub key: String,
    pub support_queues: u32,
    pub support_rate: f64,
    pub best_queue: String,
    pub best_score: f64,
    pub weighted_score: f64,
    pub rows: Vec<u16>,
    pub hold: Option<String>,
    pub queue_index: u32,
    pub depth: u32,
    pub path: Vec<String>,
    pub attack: u32,
    pub difficult_attack: u32,
    pub points: u32,
    pub all_clears: u32,
    pub difficult_clears: u32,
    pub spin_clears: u32,
    pub spin_attack: u32,
    pub t_spin_clears: u32,
    pub t_spin_attack: u32,
    pub combo: u32,
    pub back_to_back_chain: u32,
    pub t_spin_potential: u32,
    pub holes: u32,
    pub bumpiness: u32,
}

#[napi(object)]
pub struct OpenerBagTemplateMining {
    pub bag: String,
    pub total_queues: u32,
    pub searched_queues: u32,
    pub exact: bool,
    pub buildable_queues: u32,
    pub template_count: u32,
    pub top_templates: Vec<OpenerBagTemplate>,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct TemplateKey {
    rows: BoardRows,
    hold: Option<Piece>,
    queue_index: usize,
    combo: u32,
    back_to_back_chain: u32,
}

struct TemplateAggregate {
    key: TemplateKey,
    support_queues: u32,
    best_queue: String,
    best_state: SearchState,
    best_weighted_score: f64,
}

pub(crate) fn evaluate_opener_bag_internal(
    bag: &str,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    max_queues: u32,
    top_queue_count: u32,
    combo_table: ComboTable,
    kick_table: KickTable,
    spin_mode: SpinMode,
    allow_180: bool,
) -> Result<OpenerBagEvaluation> {
    let pieces = parse_unique_bag(bag)?;
    let total_queues = factorial(pieces.len());
    let max_queues = if max_queues == 0 {
        total_queues
    } else {
        usize::min(max_queues as usize, total_queues)
    };
    let top_queue_count = if top_queue_count == 0 {
        16
    } else {
        top_queue_count as usize
    };
    let beam_width = validate_beam_width(beam_width)?;
    let max_depth = usize::min(max_depth as usize, pieces.len());

    let mut evaluations = Vec::with_capacity(max_queues);
    let mut queue = Vec::with_capacity(pieces.len());
    for sample in 0..max_queues {
        write_nth_piece_permutation(
            &pieces,
            sampled_piece_permutation_index(sample, max_queues, total_queues),
            &mut queue,
        );
        let states = search_opener_states(
            &queue,
            beam_width,
            hold_enabled,
            max_depth,
            false,
            false,
            combo_table,
            kick_table,
            spin_mode,
            DEFAULT_SETUP_CANDIDATE_POOL_MULTIPLIER,
            allow_180,
        );
        evaluations.push(evaluate_queue(
            queue_to_string(&queue),
            states.into_iter().next(),
            max_depth,
        ));
    }

    mark_pareto_fronts(&mut evaluations);
    evaluations.sort_by(compare_queue_evaluation);

    let searched_queues = evaluations.len() as u32;
    let buildable_queues = evaluations
        .iter()
        .filter(|evaluation| evaluation.buildable)
        .count() as u32;
    let denominator = f64::from(searched_queues.max(1));
    let average_score = evaluations
        .iter()
        .map(|evaluation| evaluation.top_score)
        .sum::<f64>()
        / denominator;
    let average_attack = evaluations
        .iter()
        .map(|evaluation| f64::from(evaluation.attack))
        .sum::<f64>()
        / denominator;
    let average_firepower_score = evaluations
        .iter()
        .map(|evaluation| evaluation.firepower_score)
        .sum::<f64>()
        / denominator;
    let average_holes = evaluations
        .iter()
        .map(|evaluation| f64::from(evaluation.holes))
        .sum::<f64>()
        / denominator;
    let average_bumpiness = evaluations
        .iter()
        .map(|evaluation| f64::from(evaluation.bumpiness))
        .sum::<f64>()
        / denominator;
    let worst_score = evaluations
        .iter()
        .map(|evaluation| evaluation.top_score)
        .reduce(f64::min)
        .unwrap_or(0.0);
    let best_score = evaluations
        .iter()
        .map(|evaluation| evaluation.top_score)
        .reduce(f64::max)
        .unwrap_or(0.0);
    let pareto_front = evaluations
        .iter()
        .filter(|evaluation| evaluation.pareto_front)
        .take(top_queue_count)
        .cloned()
        .collect();
    let top_queues = evaluations.iter().take(top_queue_count).cloned().collect();

    Ok(OpenerBagEvaluation {
        bag: queue_to_string(&pieces),
        total_queues: total_queues as u32,
        searched_queues,
        exact: searched_queues as usize == total_queues,
        buildable_queues,
        build_rate: f64::from(buildable_queues) / denominator,
        average_score,
        average_attack,
        average_firepower_score,
        average_holes,
        average_bumpiness,
        worst_score,
        best_score,
        pareto_front,
        top_queues,
    })
}

pub(crate) fn mine_opener_bag_templates_internal(
    bag: &str,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    max_queues: u32,
    top_template_count: u32,
    include_paths: bool,
    combo_table: ComboTable,
    kick_table: KickTable,
    spin_mode: SpinMode,
    allow_180: bool,
) -> Result<OpenerBagTemplateMining> {
    let pieces = parse_unique_bag(bag)?;
    let total_queues = factorial(pieces.len());
    let max_queues = if max_queues == 0 {
        total_queues
    } else {
        usize::min(max_queues as usize, total_queues)
    };
    let top_template_count = if top_template_count == 0 {
        16
    } else {
        top_template_count as usize
    };
    let beam_width = validate_beam_width(beam_width)?;
    let max_depth = usize::min(max_depth as usize, pieces.len());

    let mut templates = FastHashMap::<TemplateKey, TemplateAggregate>::default();
    let mut queue_template_keys = FastHashSet::<TemplateKey>::default();
    let mut queue = Vec::with_capacity(pieces.len());
    let mut buildable_queues = 0_u32;

    for sample in 0..max_queues {
        write_nth_piece_permutation(
            &pieces,
            sampled_piece_permutation_index(sample, max_queues, total_queues),
            &mut queue,
        );
        let queue_name = queue_to_string(&queue);
        let states = search_opener_states(
            &queue,
            beam_width,
            hold_enabled,
            max_depth,
            false,
            false,
            combo_table,
            kick_table,
            spin_mode,
            DEFAULT_SETUP_CANDIDATE_POOL_MULTIPLIER,
            allow_180,
        );

        queue_template_keys.clear();
        let mut queue_buildable = false;
        for state in states {
            if state.depth != max_depth {
                continue;
            }
            queue_buildable = true;
            let key = template_key(&state);
            let first_for_queue = queue_template_keys.insert(key.clone());
            let weighted_score = opener_weighted_score(&state, true);
            let entry = templates
                .entry(key.clone())
                .or_insert_with(|| TemplateAggregate {
                    key,
                    support_queues: 0,
                    best_queue: queue_name.clone(),
                    best_state: state.clone(),
                    best_weighted_score: weighted_score,
                });

            if first_for_queue {
                entry.support_queues += 1;
            }
            if compare_template_state(
                &state,
                weighted_score,
                &entry.best_state,
                entry.best_weighted_score,
            )
            .is_lt()
            {
                entry.best_queue = queue_name.clone();
                entry.best_state = state;
                entry.best_weighted_score = weighted_score;
            }
        }
        if queue_buildable {
            buildable_queues += 1;
        }
    }

    let searched_queues = max_queues as u32;
    let denominator = f64::from(searched_queues.max(1));
    let mut top_templates = templates
        .into_values()
        .map(|aggregate| template_from_aggregate(aggregate, denominator))
        .collect::<Vec<_>>();
    top_templates.sort_by(compare_template);
    let template_count = top_templates.len() as u32;
    top_templates.truncate(top_template_count);
    if include_paths {
        hydrate_template_paths(
            &mut top_templates,
            beam_width,
            hold_enabled,
            max_depth,
            combo_table,
            kick_table,
            spin_mode,
            allow_180,
        )?;
    }

    Ok(OpenerBagTemplateMining {
        bag: queue_to_string(&pieces),
        total_queues: total_queues as u32,
        searched_queues,
        exact: max_queues == total_queues,
        buildable_queues,
        template_count,
        top_templates,
    })
}

fn parse_unique_bag(input: &str) -> Result<Vec<Piece>> {
    let pieces = parse_queue(input)?;
    if pieces.len() > 7 {
        return Err(Error::from_reason(format!(
            "bag must contain at most 7 unique tetrominoes, got {}.",
            pieces.len()
        )));
    }

    let mut unique = Vec::with_capacity(pieces.len());
    for piece in pieces {
        if unique.contains(&piece) {
            return Err(Error::from_reason(format!(
                "bag must not repeat tetromino {}.",
                piece_name(piece)
            )));
        }
        unique.push(piece);
    }
    Ok(unique)
}

fn factorial(value: usize) -> usize {
    (1..=value).product::<usize>().max(1)
}

fn sampled_piece_permutation_index(
    sample: usize,
    queue_count: usize,
    total_queues: usize,
) -> usize {
    if queue_count == total_queues {
        sample
    } else {
        (sample * BAG_SAMPLE_MULTIPLIER) % total_queues
    }
}

#[cfg(test)]
fn nth_piece_permutation(pieces: &[Piece], index: usize) -> Vec<Piece> {
    let mut output = Vec::with_capacity(pieces.len());
    write_nth_piece_permutation(pieces, index, &mut output);
    output
}

fn write_nth_piece_permutation(pieces: &[Piece], index: usize, output: &mut Vec<Piece>) {
    let mut remaining = [Piece::I; 7];
    for (slot, piece) in remaining.iter_mut().zip(pieces.iter().copied()) {
        *slot = piece;
    }

    output.clear();
    let mut remaining_len = pieces.len();
    let mut cursor = index;
    for divisor in (1..=pieces.len()).rev() {
        let block = factorial(divisor - 1);
        let selected = cursor / block;
        debug_assert!(selected < remaining_len);
        output.push(remaining[selected]);
        remaining.copy_within(selected + 1..remaining_len, selected);
        remaining_len -= 1;
        cursor %= block;
    }
}

fn queue_to_string(pieces: &[Piece]) -> String {
    pieces.iter().map(|piece| piece_name(*piece)).collect()
}

fn evaluate_queue(
    queue: String,
    state: Option<SearchState>,
    target_depth: usize,
) -> OpenerQueueEvaluation {
    let Some(state) = state else {
        return OpenerQueueEvaluation {
            queue,
            buildable: false,
            pareto_front: false,
            dominated_by: 0,
            weighted_score: f64::NEG_INFINITY,
            top_score: f64::NEG_INFINITY,
            firepower_score: 0.0,
            attack: 0,
            difficult_attack: 0,
            points: 0,
            all_clears: 0,
            difficult_clears: 0,
            spin_clears: 0,
            spin_attack: 0,
            t_spin_clears: 0,
            t_spin_attack: 0,
            back_to_back_chain: 0,
            t_spin_potential: 0,
            depth: 0,
            holes: u32::MAX,
            bumpiness: u32::MAX,
        };
    };

    let depth = state.depth as u32;
    let buildable = state.depth == target_depth;
    let firepower_score = firepower_score(state.firepower);
    let weighted_score = opener_weighted_score(&state, buildable);
    OpenerQueueEvaluation {
        queue,
        buildable,
        pareto_front: false,
        dominated_by: 0,
        weighted_score,
        top_score: state.score,
        firepower_score,
        attack: state.firepower.attack,
        difficult_attack: state.firepower.difficult_attack,
        points: state.firepower.points,
        all_clears: state.firepower.all_clears,
        difficult_clears: state.firepower.difficult_clears,
        spin_clears: state.firepower.spin_clears,
        spin_attack: state.firepower.spin_attack,
        t_spin_clears: state.firepower.t_spin_clears,
        t_spin_attack: state.firepower.t_spin_attack,
        back_to_back_chain: state.firepower.back_to_back_chain,
        t_spin_potential: state.t_spin_potential,
        depth,
        holes: state.metrics[3],
        bumpiness: state.metrics[4],
    }
}

fn opener_weighted_score(state: &SearchState, buildable: bool) -> f64 {
    let buildable_bonus = if buildable { 10_000.0 } else { 0.0 };
    buildable_bonus
        + state.score
        + f64::from(state.firepower.difficult_attack) * 900.0
        + f64::from(state.firepower.spin_attack) * 1_200.0
        + f64::from(state.firepower.spin_clears) * 2_500.0
        + f64::from(state.firepower.difficult_clears) * 1_200.0
        + f64::from(state.firepower.back_to_back_chain) * 1_000.0
        + f64::from(state.t_spin_potential) * 800.0
        + state.depth as f64 * 250.0
        - f64::from(state.firepower.all_clears) * 120_000.0
        - f64::from(state.metrics[3]) * 120.0
        - f64::from(state.metrics[4]) * 20.0
}

fn template_key(state: &SearchState) -> TemplateKey {
    TemplateKey {
        rows: state.rows,
        hold: state.hold,
        queue_index: state.queue_index,
        combo: state.firepower.combo,
        back_to_back_chain: state.firepower.back_to_back_chain,
    }
}

fn compare_template_state(
    left_state: &SearchState,
    left_weighted_score: f64,
    right_state: &SearchState,
    right_weighted_score: f64,
) -> std::cmp::Ordering {
    left_state
        .firepower
        .all_clears
        .cmp(&right_state.firepower.all_clears)
        .then_with(|| {
            right_state
                .firepower
                .spin_clears
                .cmp(&left_state.firepower.spin_clears)
        })
        .then_with(|| {
            right_state
                .firepower
                .spin_attack
                .cmp(&left_state.firepower.spin_attack)
        })
        .then_with(|| {
            right_state
                .firepower
                .t_spin_clears
                .cmp(&left_state.firepower.t_spin_clears)
        })
        .then_with(|| {
            right_state
                .firepower
                .t_spin_attack
                .cmp(&left_state.firepower.t_spin_attack)
        })
        .then_with(|| {
            right_state
                .firepower
                .difficult_attack
                .cmp(&left_state.firepower.difficult_attack)
        })
        .then_with(|| {
            right_state
                .firepower
                .back_to_back_chain
                .cmp(&left_state.firepower.back_to_back_chain)
        })
        .then_with(|| {
            right_state
                .t_spin_potential
                .cmp(&left_state.t_spin_potential)
        })
        .then_with(|| right_weighted_score.total_cmp(&left_weighted_score))
        .then_with(|| left_state.metrics[3].cmp(&right_state.metrics[3]))
        .then_with(|| left_state.metrics[4].cmp(&right_state.metrics[4]))
        .then_with(|| {
            left_state
                .path_tie_breaker
                .cmp(&right_state.path_tie_breaker)
        })
}

fn template_from_aggregate(
    aggregate: TemplateAggregate,
    searched_queue_denominator: f64,
) -> OpenerBagTemplate {
    let state = aggregate.best_state;
    OpenerBagTemplate {
        key: format_template_key(&aggregate.key),
        support_queues: aggregate.support_queues,
        support_rate: f64::from(aggregate.support_queues) / searched_queue_denominator,
        best_queue: aggregate.best_queue,
        best_score: state.score,
        weighted_score: aggregate.best_weighted_score,
        rows: state.rows.to_vec(),
        hold: state.hold.map(|piece| piece_name(piece).to_string()),
        queue_index: state.queue_index as u32,
        depth: state.depth as u32,
        path: state
            .path
            .iter()
            .copied()
            .map(|step| step.format())
            .collect(),
        attack: state.firepower.attack,
        difficult_attack: state.firepower.difficult_attack,
        points: state.firepower.points,
        all_clears: state.firepower.all_clears,
        difficult_clears: state.firepower.difficult_clears,
        spin_clears: state.firepower.spin_clears,
        spin_attack: state.firepower.spin_attack,
        t_spin_clears: state.firepower.t_spin_clears,
        t_spin_attack: state.firepower.t_spin_attack,
        combo: state.firepower.combo,
        back_to_back_chain: state.firepower.back_to_back_chain,
        t_spin_potential: state.t_spin_potential,
        holes: state.metrics[3],
        bumpiness: state.metrics[4],
    }
}

fn format_template_key(key: &TemplateKey) -> String {
    let rows = key
        .rows
        .iter()
        .map(|row| row.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let hold = key.hold.map(piece_name).unwrap_or("-");
    format!(
        "{rows}|hold={hold}|queue={}|combo={}|b2b={}",
        key.queue_index, key.combo, key.back_to_back_chain
    )
}

fn compare_template(left: &OpenerBagTemplate, right: &OpenerBagTemplate) -> std::cmp::Ordering {
    right
        .support_queues
        .cmp(&left.support_queues)
        .then_with(|| left.all_clears.cmp(&right.all_clears))
        .then_with(|| right.spin_clears.cmp(&left.spin_clears))
        .then_with(|| right.spin_attack.cmp(&left.spin_attack))
        .then_with(|| right.t_spin_clears.cmp(&left.t_spin_clears))
        .then_with(|| right.t_spin_attack.cmp(&left.t_spin_attack))
        .then_with(|| right.back_to_back_chain.cmp(&left.back_to_back_chain))
        .then_with(|| right.difficult_attack.cmp(&left.difficult_attack))
        .then_with(|| right.t_spin_potential.cmp(&left.t_spin_potential))
        .then_with(|| right.weighted_score.total_cmp(&left.weighted_score))
        .then_with(|| left.holes.cmp(&right.holes))
        .then_with(|| left.bumpiness.cmp(&right.bumpiness))
        .then_with(|| left.key.cmp(&right.key))
}

fn hydrate_template_paths(
    templates: &mut [OpenerBagTemplate],
    beam_width: usize,
    hold_enabled: bool,
    max_depth: usize,
    combo_table: ComboTable,
    kick_table: KickTable,
    spin_mode: SpinMode,
    allow_180: bool,
) -> Result<()> {
    let mut hydrated = vec![false; templates.len()];
    for index in 0..templates.len() {
        if hydrated[index] {
            continue;
        }

        let queue_name = templates[index].best_queue.clone();
        let queue = parse_queue(&queue_name)?;
        let states = search_opener_states(
            &queue,
            beam_width,
            hold_enabled,
            max_depth,
            false,
            true,
            combo_table,
            kick_table,
            spin_mode,
            DEFAULT_SETUP_CANDIDATE_POOL_MULTIPLIER,
            allow_180,
        );

        for state in states {
            for template_index in 0..templates.len() {
                if hydrated[template_index] || templates[template_index].best_queue != queue_name {
                    continue;
                }
                if matches_template(&state, &templates[template_index]) {
                    templates[template_index].path = state
                        .path
                        .iter()
                        .copied()
                        .map(|step| step.format())
                        .collect();
                    hydrated[template_index] = true;
                }
            }
        }
    }
    Ok(())
}

fn matches_template(state: &SearchState, template: &OpenerBagTemplate) -> bool {
    state.depth == template.depth as usize
        && state.queue_index == template.queue_index as usize
        && state.rows.as_slice() == template.rows.as_slice()
        && state.hold.map(piece_name) == template.hold.as_deref()
        && state.firepower.combo == template.combo
        && state.firepower.back_to_back_chain == template.back_to_back_chain
        && state.firepower.attack == template.attack
        && state.firepower.difficult_attack == template.difficult_attack
        && state.firepower.points == template.points
        && state.firepower.all_clears == template.all_clears
        && state.firepower.difficult_clears == template.difficult_clears
        && state.firepower.spin_clears == template.spin_clears
        && state.firepower.spin_attack == template.spin_attack
        && state.firepower.t_spin_clears == template.t_spin_clears
        && state.firepower.t_spin_attack == template.t_spin_attack
        && state.t_spin_potential == template.t_spin_potential
}

fn mark_pareto_fronts(evaluations: &mut [OpenerQueueEvaluation]) {
    for index in 0..evaluations.len() {
        let mut dominated_by = 0;
        for other_index in 0..evaluations.len() {
            if index != other_index && dominates(&evaluations[other_index], &evaluations[index]) {
                dominated_by += 1;
            }
        }
        evaluations[index].dominated_by = dominated_by;
        evaluations[index].pareto_front = dominated_by == 0;
    }
}

fn dominates(left: &OpenerQueueEvaluation, right: &OpenerQueueEvaluation) -> bool {
    let no_worse = u8::from(left.buildable) >= u8::from(right.buildable)
        && left.depth >= right.depth
        && left.spin_clears >= right.spin_clears
        && left.spin_attack >= right.spin_attack
        && left.t_spin_clears >= right.t_spin_clears
        && left.t_spin_attack >= right.t_spin_attack
        && left.back_to_back_chain >= right.back_to_back_chain
        && left.difficult_clears >= right.difficult_clears
        && left.difficult_attack >= right.difficult_attack
        && left.t_spin_potential >= right.t_spin_potential
        && left.attack >= right.attack
        && left.top_score >= right.top_score
        && left.all_clears <= right.all_clears
        && left.holes <= right.holes
        && left.bumpiness <= right.bumpiness;
    let strictly_better = u8::from(left.buildable) > u8::from(right.buildable)
        || left.depth > right.depth
        || left.spin_clears > right.spin_clears
        || left.spin_attack > right.spin_attack
        || left.t_spin_clears > right.t_spin_clears
        || left.t_spin_attack > right.t_spin_attack
        || left.back_to_back_chain > right.back_to_back_chain
        || left.difficult_clears > right.difficult_clears
        || left.difficult_attack > right.difficult_attack
        || left.t_spin_potential > right.t_spin_potential
        || left.attack > right.attack
        || left.top_score > right.top_score
        || left.all_clears < right.all_clears
        || left.holes < right.holes
        || left.bumpiness < right.bumpiness;
    no_worse && strictly_better
}

fn compare_queue_evaluation(
    left: &OpenerQueueEvaluation,
    right: &OpenerQueueEvaluation,
) -> std::cmp::Ordering {
    right
        .pareto_front
        .cmp(&left.pareto_front)
        .then_with(|| left.dominated_by.cmp(&right.dominated_by))
        .then_with(|| left.all_clears.cmp(&right.all_clears))
        .then_with(|| right.weighted_score.total_cmp(&left.weighted_score))
        .then_with(|| right.spin_clears.cmp(&left.spin_clears))
        .then_with(|| right.spin_attack.cmp(&left.spin_attack))
        .then_with(|| right.t_spin_clears.cmp(&left.t_spin_clears))
        .then_with(|| right.t_spin_attack.cmp(&left.t_spin_attack))
        .then_with(|| right.back_to_back_chain.cmp(&left.back_to_back_chain))
        .then_with(|| right.difficult_attack.cmp(&left.difficult_attack))
        .then_with(|| right.t_spin_potential.cmp(&left.t_spin_potential))
        .then_with(|| right.top_score.total_cmp(&left.top_score))
        .then_with(|| left.queue.cmp(&right.queue))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_piece_permutations_keep_factorial_coverage() {
        let pieces = vec![Piece::T, Piece::I, Piece::O];
        let permutations = sampled_piece_permutations(&pieces, 6);
        let queues = permutations
            .iter()
            .map(|queue| queue_to_string(queue))
            .collect::<Vec<_>>();

        assert_eq!(queues.len(), 6);
        assert_eq!(queues, vec!["TIO", "TOI", "ITO", "IOT", "OTI", "OIT"]);
    }

    #[test]
    fn capped_piece_permutations_sample_across_first_pieces() {
        let pieces = vec![
            Piece::T,
            Piece::I,
            Piece::J,
            Piece::L,
            Piece::O,
            Piece::S,
            Piece::Z,
        ];
        let permutations = sampled_piece_permutations(&pieces, 12);
        let mut first_pieces = permutations
            .iter()
            .map(|queue| piece_name(queue[0]))
            .collect::<Vec<_>>();
        first_pieces.sort_unstable();
        first_pieces.dedup();

        assert_eq!(permutations.len(), 12);
        assert!(
            first_pieces.len() > 1,
            "capped sampling should not stay in the first DFS prefix"
        );
    }

    #[test]
    fn template_mining_covers_all_small_bag_orders() {
        let report = mine_opener_bag_templates_internal(
            "TIO",
            32,
            true,
            3,
            0,
            4,
            true,
            ComboTable::Multiplier,
            KickTable::SrsPlus,
            SpinMode::TSpins,
            true,
        )
        .expect("template mining should succeed");

        assert_eq!(report.bag, "TIO");
        assert_eq!(report.total_queues, 6);
        assert_eq!(report.searched_queues, 6);
        assert!(report.exact);
        assert_eq!(report.buildable_queues, 6);
        assert!(report.template_count > 0);
        assert!(!report.top_templates.is_empty());
        assert!(report.top_templates[0].support_queues > 0);
        assert!(report.top_templates[0].support_rate > 0.0);
        assert_eq!(
            report.top_templates[0].rows.len(),
            crate::board::BOARD_HEIGHT
        );
        assert_eq!(report.top_templates[0].path.len(), 3);
    }

    fn sampled_piece_permutations(pieces: &[Piece], queue_count: usize) -> Vec<Vec<Piece>> {
        let total_queues = factorial(pieces.len());
        (0..queue_count)
            .map(|sample| {
                nth_piece_permutation(
                    pieces,
                    sampled_piece_permutation_index(sample, queue_count, total_queues),
                )
            })
            .collect()
    }
}
