%% Export a sensored matrix run to data/matrix.json for the drive explorer page.
%
%   export_matrix_json('matrix_20260928_132634')
%
% Reads the run's matrix_summary.csv, keeps the loaded measurement window of each
% case, and writes the JSON the web page fetches. Re-run this after any new matrix
% run so the page and the simulation cannot drift apart. The parameter block must
% match single_motor_sensored_parameters.m, because the page solves the same
% equations live; if you change a motor parameter, change it here too.
function export_matrix_json(runName)
arguments
    runName (1,:) char
end
here = fileparts(mfilename('fullpath'));
investigation = fileparts(fileparts(fileparts(here)));
csvPath = fullfile(investigation,'SIMULATION','results','single_motor_sensored',runName,'matrix_summary.csv');
assert(isfile(csvPath),'No matrix_summary.csv for run %s.',runName);
rows = readtable(csvPath,'TextType','string');
rows = rows(rows.window=="load",:);

cases = struct('rpm',{},'load_Nm',{},'iq_A',{},'torque_Nm',{},'max_duty',{},'modulation',{}, ...
    'duty_sat_pct',{},'p_dc_W',{},'p_load_W',{},'p_cu_W',{},'p_fric_W',{},'efficiency_pct',{},'peak_iq_A',{});
for k = 1:height(rows)
    r = rows(k,:);
    cases(k) = struct('rpm',r.target_speed_rpm,'load_Nm',r.load_step_Nm,'iq_A',r.rms_iq_A, ...
        'torque_Nm',r.mean_torque_em_Nm,'max_duty',r.max_actual_duty,'modulation',r.max_svm_modulation, ...
        'duty_sat_pct',r.duty_saturation_percent,'p_dc_W',r.mean_dc_input_power_W, ...
        'p_load_W',r.mean_load_power_W,'p_cu_W',r.mean_copper_loss_W,'p_fric_W',r.other_model_losses_W, ...
        'efficiency_pct',r.model_efficiency_percent,'peak_iq_A',r.run_peak_abs_iq_A);
end

% Must mirror the model's parameter file.
Kt = 0.1061; p = 3;
parameters = struct('vdc_V',26.5,'Kt_NmPerA',Kt,'pole_pairs',p,'Rs_ohm',0.05, ...
    'Ld_H',1e-4,'Lq_H',1e-4,'J_kgm2',2.7e-3,'B_Nms',4.924e-4,'iq_limit_A',25, ...
    'voltage_utilisation',0.90,'flux_Wb',(2/3)*Kt/p,'ramp_s',0.5);

data = struct('source',struct('run',runName,'script','SIMULATION/run_single_motor_sensored_matrix.m', ...
    'model','investigation_pmsm_sensored_foc.slx','date',datestr(now,'yyyy-mm-dd'),'cases',numel(cases), ...
    'note',['One-motor sensored FOC simulation, averaged inverter, ideal sensored feedback. ' ...
            'Provisional BM1109 parameters; not validated against hardware.']), ...
    'parameters',parameters,'cases',cases);

outPath = fullfile(here,'..','data','matrix.json');
fid = fopen(outPath,'w');
assert(fid>0,'Cannot write %s',outPath);
cleanup = onCleanup(@() fclose(fid));
fwrite(fid,jsonencode(data,'PrettyPrint',true),'char');
fprintf('Wrote %s (%d cases from %s)\n',outPath,numel(cases),runName);
end
