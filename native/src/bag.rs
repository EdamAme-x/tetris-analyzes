use napi::bindgen_prelude::{Error, Result};
use napi_derive::napi;

use crate::firepower::firepower_score;
use crate::movement::KickTable;
use crate::pieces::{parse_queue, piece_name, Piece};
use crate::tetrio_tables::ComboTable;
use crate::{search_opener_states, validate_beam_width, SearchState};

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
    pub points: u32,
    pub all_clears: u32,
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

pub(crate) fn evaluate_opener_bag_internal(
    bag: &str,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    max_queues: u32,
    top_queue_count: u32,
    combo_table: ComboTable,
    kick_table: KickTable,
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
    let queues = generate_piece_permutations(&pieces, max_queues);

    let mut evaluations = Vec::with_capacity(queues.len());
    for queue in queues {
        let states = search_opener_states(
            &queue,
            beam_width,
            hold_enabled,
            max_depth,
            false,
            combo_table,
            kick_table,
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

fn generate_piece_permutations(pieces: &[Piece], max_queues: usize) -> Vec<Vec<Piece>> {
    let mut remaining = pieces.to_vec();
    let mut current = Vec::with_capacity(pieces.len());
    let mut output = Vec::with_capacity(max_queues);
    push_piece_permutations(&mut remaining, &mut current, &mut output, max_queues);
    output
}

fn push_piece_permutations(
    remaining: &mut Vec<Piece>,
    current: &mut Vec<Piece>,
    output: &mut Vec<Vec<Piece>>,
    max_queues: usize,
) {
    if output.len() >= max_queues {
        return;
    }
    if remaining.is_empty() {
        output.push(current.clone());
        return;
    }

    for index in 0..remaining.len() {
        let piece = remaining.remove(index);
        current.push(piece);
        push_piece_permutations(remaining, current, output, max_queues);
        current.pop();
        remaining.insert(index, piece);
        if output.len() >= max_queues {
            return;
        }
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
            points: 0,
            all_clears: 0,
            depth: 0,
            holes: u32::MAX,
            bumpiness: u32::MAX,
        };
    };

    let depth = state.path.len() as u32;
    let buildable = state.path.len() == target_depth;
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
        points: state.firepower.points,
        all_clears: state.firepower.all_clears,
        depth,
        holes: state.metrics[3],
        bumpiness: state.metrics[4],
    }
}

fn opener_weighted_score(state: &SearchState, buildable: bool) -> f64 {
    let buildable_bonus = if buildable { 10_000.0 } else { 0.0 };
    buildable_bonus
        + state.score
        + f64::from(state.firepower.attack) * 500.0
        + f64::from(state.firepower.all_clears) * 1_000.0
        + state.path.len() as f64 * 250.0
        - f64::from(state.metrics[3]) * 120.0
        - f64::from(state.metrics[4]) * 20.0
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
        && left.attack >= right.attack
        && left.all_clears >= right.all_clears
        && left.top_score >= right.top_score
        && left.holes <= right.holes
        && left.bumpiness <= right.bumpiness;
    let strictly_better = u8::from(left.buildable) > u8::from(right.buildable)
        || left.depth > right.depth
        || left.attack > right.attack
        || left.all_clears > right.all_clears
        || left.top_score > right.top_score
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
        .then_with(|| right.weighted_score.total_cmp(&left.weighted_score))
        .then_with(|| right.top_score.total_cmp(&left.top_score))
        .then_with(|| left.queue.cmp(&right.queue))
}
