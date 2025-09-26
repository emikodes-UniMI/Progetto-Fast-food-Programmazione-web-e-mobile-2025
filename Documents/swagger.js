import swaggerAutogen from 'swagger-autogen';

const doc = {
    info: {
      title: 'FastFood API - Ingenito Emiddio',
      description: 'Documentazione endpoint API REST, per il progetto "FastFood" del corso di Programmazione Web e Mobile - A.A. 2025/2026'
    },
    host: 'localhost:3000'
  };

const outputFile = './swagger.json';
const inputFiles = ['./index.js'];

swaggerAutogen(outputFile,inputFiles, doc);
