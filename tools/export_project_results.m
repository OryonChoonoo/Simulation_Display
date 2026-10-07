function export_project_results(projectRoot)
%EXPORT_PROJECT_RESULTS Export checked simulation evidence for the website.
%   export_project_results(PROJECTROOT) reads the latest matched 0.5 N.m
%   sensored/sensorless sweep and writes browser-friendly JSON into data/.

if nargin < 1 || strlength(string(projectRoot)) == 0
    siteRoot = fileparts(fileparts(mfilename('fullpath')));
    projectRoot = fileparts(siteRoot);
else
    projectRoot = char(projectRoot);
    siteRoot = fullfile(projectRoot, 'Simulation_Display');
end

runName = 'load_comparison_full_speed_sweep_0p5Nm_20261007_111543';
runDir = fullfile(projectRoot, 'SIMULATION', 'results', ...
    'sensored_sensorless_load_comparison', runName);
summaryFile = fullfile(runDir, 'load_comparison_summary.csv');
assert(isfile(summaryFile), 'Missing comparison summary: %s', summaryFile);

T = readtable(summaryFile, 'VariableNamingRule', 'preserve');
T = removevars(T, 'raw_file'); % Do not publish workstation paths.
sweep = struct();
sweep.schema_version = 1;
sweep.title = 'Matched sensored and sensorless speed sweep';
sweep.source = struct('run', runName, 'date', '2026-10-07', ...
    'kind', 'simulation', 'model', 'working_single_motor_sensorless', ...
    'note', ['Same motor and 0.5 N.m load. Sensorless startup is encoder-assisted. ' ...
             'The 200 rpm case falls back to encoder and is excluded from sustained sensorless claims.']);
sweep.conditions = struct('load_Nm', 0.5, 'bus_voltage_V', 26.5, ...
    'sensorless_absolute_current_guard_A', 7.0, ...
    'sensorless_closed_loop_iq_limit_A', 5.0, ...
    'sensored_iq_limit_A', 25.0);
sweep.cases = table2struct(T);
writeJson(fullfile(siteRoot, 'data', 'sensorless_speed_sweep.json'), sweep);

% A representative matched transient at 800 rpm and 0.5 N.m.
sens = load(fullfile(runDir, 'sensored_0800rpm_0.50Nm.mat'));
sl = load(fullfile(runDir, 'sensorless_0800rpm_0.50Nm.mat'));
t = (0:0.002:1.8)';
tr = struct();
tr.schema_version = 1;
tr.title = 'Matched 800 rpm, 0.5 N.m transient';
tr.source = struct('run', runName, 'date', '2026-10-07', 'kind', 'simulation');
tr.conditions = struct('speed_rpm', 800, 'load_Nm', 0.5, 'load_step_time_s', 1.0);
tr.time_s = round(t, 6);
tr.speed_reference_rpm = round(sample(sens.simOut, 'sens_speed_ref_rpm', t), 5);
tr.sensored_true_speed_rpm = round(sample(sens.simOut, 'sens_speed_radps', t) * 60/(2*pi), 5);
tr.sensorless_true_speed_rpm = round(sample(sl.simOut, 'sens_speed_radps', t) * 60/(2*pi), 5);
tr.sensorless_estimated_speed_rpm = round(sample(sl.simOut, 'sl_speed_est_radps', t) * 60/(2*pi), 5);
tr.sensorless_angle_error_deg = round(sample(sl.simOut, 'sl_angle_error_rad', t) * 180/pi, 5);
tr.sensored_phase_current_peak_A = round(rowPeak(sample(sens.simOut, 'sens_phase_currents_A', t)), 5);
tr.sensorless_phase_current_peak_A = round(rowPeak(sample(sl.simOut, 'sens_phase_currents_A', t)), 5);
tr.sensorless_handover_alpha = round(sample(sl.simOut, 'sl_handover_alpha', t), 5);
tr.sensorless_closed_loop = sample(sl.simOut, 'sl_closed_loop_active', t) >= 0.5;
writeJson(fullfile(siteRoot, 'data', 'comparison_800rpm.json'), tr);

% Successful guarded startup used to explain alignment, pull-in and handover.
startupFile = fullfile(projectRoot, 'SIMULATION', 'results', ...
    'single_motor_sensorless_guarded_handover', 'guarded_handover_20261002_100957.mat');
st = load(startupFile);
ts = (0:0.002:1.6)';
su = struct();
su.schema_version = 1;
su.title = 'Guarded sensorless startup and handover';
su.source = struct('file', 'guarded_handover_20261002_100957.mat', ...
    'date', '2026-10-02', 'kind', 'simulation', ...
    'note', 'Encoder-assisted startup/handover; not a standstill sensorless start.');
su.time_s = round(ts, 6);
su.true_speed_rpm = round(sample(st.simOut, 'sens_speed_radps', ts) * 60/(2*pi), 5);
su.estimated_speed_rpm = round(sample(st.simOut, 'sl_speed_est_radps', ts) * 60/(2*pi), 5);
su.angle_error_deg = round(sample(st.simOut, 'sl_angle_error_rad', ts) * 180/pi, 5);
su.handover_alpha = round(sample(st.simOut, 'sl_handover_alpha', ts), 5);
su.alignment_active = sample(st.simOut, 'sl_alignment_active', ts) >= 0.5;
su.handover_active = sample(st.simOut, 'sl_handover_active', ts) >= 0.5;
su.closed_loop_active = sample(st.simOut, 'sl_closed_loop_active', ts) >= 0.5;
su.observer_valid = sample(st.simOut, 'sl_observer_valid', ts) >= 0.5;
su.startup_abort = sample(st.simOut, 'sl_startup_abort', ts) >= 0.5;
writeJson(fullfile(siteRoot, 'data', 'sensorless_startup.json'), su);

fprintf('Exported sweep, matched transient and startup JSON to %s\n', fullfile(siteRoot, 'data'));
end

function y = sample(simOut, name, tq)
x = simOut.get(name);
if isa(x, 'timeseries')
    tx = x.Time(:);
    data = squeeze(x.Data);
else
    tx = x.Values.Time(:);
    data = squeeze(x.Values.Data);
end
if isvector(data), data = data(:); end
if size(data, 1) ~= numel(tx) && size(data, 2) == numel(tx), data = data.'; end
[tx, keep] = unique(tx, 'stable');
data = data(keep, :);
y = interp1(tx, double(data), tq, 'linear', 'extrap');
end

function y = rowPeak(x)
if isvector(x), y = abs(x(:)); else, y = max(abs(x), [], 2); end
end

function writeJson(path, value)
text = jsonencode(value);
fid = fopen(path, 'w');
assert(fid >= 0, 'Cannot write %s', path);
cleaner = onCleanup(@() fclose(fid)); %#ok<NASGU>
fwrite(fid, text, 'char');
end
