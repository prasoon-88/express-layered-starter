import type { Request, Response } from 'express';

export const homeController = {
  getHome: (req: Request, res: Response) => {
    res.render('home', { title: 'Home' });
  },
};
