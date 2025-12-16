
import React from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    // Area removed
} from 'recharts';
import { Card, Button } from 'react-bootstrap';
// Remove unused imports if any

// Props

export interface CurveDataPoint {
    periodo: string; // Date string usually
    programado_acumulado: number;
    ejecutado_acumulado: number;
}

interface CurvaSChartProps {
    data: CurveDataPoint[];
    title?: string;
}

const CurvaSChart: React.FC<CurvaSChartProps> = ({ data, title = "Curva S - Avance Financiero" }) => {
    return (
        <Card className="shadow-sm">
            <Card.Header className="bg-white fw-bold">{title}</Card.Header>
            <Card.Body>
                <div id="s-curve-chart" style={{ width: '100%', height: 400 }}>
                    <ResponsiveContainer>
                        <LineChart
                            data={data}
                            margin={{
                                top: 20,
                                right: 30,
                                left: 20,
                                bottom: 5,
                            }}
                        >
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis dataKey="periodo" stroke="#6c757d" fontSize={12} />
                            <YAxis stroke="#6c757d" fontSize={12} unit="S/" />
                            <Tooltip
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                            />
                            <Legend verticalAlign="top" height={36} />

                            {/* Programado Line - Blue/Primary */}
                            <Line
                                type="monotone"
                                dataKey="programado_acumulado"
                                name="Programado Acumulado"
                                stroke="#0d6efd"
                                strokeWidth={3}
                                dot={{ r: 4 }}
                                activeDot={{ r: 8 }}
                            />

                            {/* Ejecutado Line - Green/Success or Red/Danger depending on logic? Standard is Green/Orange etc. Let's use Orange for contrast or Success green. */}
                            <Line
                                type="monotone"
                                dataKey="ejecutado_acumulado"
                                name="Ejecutado Acumulado"
                                stroke="#198754"
                                strokeWidth={3}
                                dot={{ r: 4 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </Card.Body>
        </Card>
    );
};

export default CurvaSChart;
